const express = require('express');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { db, UPLOAD_DIR } = require('./db');
const { requireAuth, requireRole } = require('./auth');

const router = express.Router();

const MODEL = 'claude-opus-5';
const MAX_DOC_BYTES = 18 * 1024 * 1024; // stay under the API's 32MB request limit after base64

const SYSTEM_PROMPT = `You are the quote comparison assistant inside Central Pharma's project management portal. Operations staff upload supplier quotes and rely on you for logical, measured analysis so they can exercise their own judgment from an accurate picture.

Always:
- Check whether quotes cover the same scope before comparing prices. Flag any scope mismatch prominently (e.g. one supplier quoting fewer work areas, excluded services, different specifications, different deck heights or footprints).
- List pros AND cons for every supplier, covering price, scope coverage, timeline/installation speed, exclusions, warranties, payment terms, and reliability/reputation where evidenced in the documents. A more expensive supplier may still be the better choice — say so when the evidence supports it.
- Use pounds sterling (£) for all amounts. Note VAT treatment when quotes differ on it.
- Be explicit about assumptions, missing information, and what the operator should clarify with suppliers before deciding.
- Present comparisons in clear structures (short tables or bullet lists), keeping prose plain and readable for a busy operations worker.
- Give a reasoned recommendation when asked, but make clear the final judgment rests with the operator.
- Only draw on the project context and documents provided; never invent figures. If the documents don't contain something, say so.`;

// Convert this project's uploaded documents into Claude content blocks.
function buildDocBlocks(docs) {
  const blocks = [];
  const skipped = [];
  let total = 0;
  for (const d of docs) {
    const filePath = path.join(UPLOAD_DIR, d.stored_name);
    if (!fs.existsSync(filePath)) {
      skipped.push(`${d.original_name} (file missing)`);
      continue;
    }
    const ext = path.extname(d.original_name).toLowerCase();
    const imageTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
    const isText = ['.txt', '.csv', '.md', '.json'].includes(ext);
    if (ext !== '.pdf' && !imageTypes[ext] && !isText) {
      skipped.push(`${d.original_name} (unsupported format — upload PDF, image, or text)`);
      continue;
    }
    const buf = fs.readFileSync(filePath);
    if (total + buf.length > MAX_DOC_BYTES) {
      skipped.push(`${d.original_name} (combined size limit reached)`);
      continue;
    }
    total += buf.length;
    if (ext === '.pdf') {
      blocks.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') },
        title: d.original_name,
      });
    } else if (imageTypes[ext]) {
      blocks.push({ type: 'image', source: { type: 'base64', media_type: imageTypes[ext], data: buf.toString('base64') } });
    } else {
      blocks.push({
        type: 'document',
        source: { type: 'text', media_type: 'text/plain', data: buf.toString('utf8').slice(0, 200000) },
        title: d.original_name,
      });
    }
  }
  return { blocks, skipped };
}

function buildContextText(project, quotes, skipped) {
  const intake = project.intake ? (() => { try { return JSON.parse(project.intake); } catch { return null; } })() : null;
  const lines = [
    `PROJECT: ${project.name}`,
    project.client && `Client: ${project.client}`,
    project.department && `Department: ${project.department}`,
    project.priority && `Priority: ${project.priority}`,
    project.budget != null && `Budget: £${project.budget}`,
    project.due_date && `Target date: ${project.due_date}`,
    project.description && `Description: ${project.description}`,
  ].filter(Boolean);
  if (intake) {
    lines.push('', 'PROJECT INTAKE ANSWERS:');
    for (const [k, v] of Object.entries(intake)) {
      if (v && String(v).trim()) lines.push(`- ${k}: ${Array.isArray(v) ? v.join(', ') : v}`);
    }
  }
  if (quotes.length) {
    lines.push('', 'QUOTES LOGGED IN THE PORTAL:');
    for (const q of quotes) {
      lines.push(`- ${q.vendor}${q.reference ? ` (ref ${q.reference})` : ''}: £${q.amount} — status ${q.status}${q.quote_date ? `, dated ${q.quote_date}` : ''}${q.notes ? `. Notes: ${q.notes}` : ''}`);
    }
  }
  if (skipped.length) {
    lines.push('', `DOCUMENTS THAT COULD NOT BE ATTACHED: ${skipped.join('; ')}`);
  }
  lines.push('', 'The supplier quote documents uploaded for this project are attached above.');
  return lines.join('\n');
}

router.post('/projects/:id/ai-compare', requireAuth, requireRole('manager'), async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error: 'AI comparison is not configured yet. An administrator needs to add the ANTHROPIC_API_KEY environment variable on the server.',
    });
  }
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0 || messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'messages must end with a user message' });
  }

  const quotes = db.prepare('SELECT * FROM quotes WHERE project_id = ? ORDER BY quote_date, id').all(project.id);
  const docs = db.prepare('SELECT * FROM documents WHERE project_id = ? ORDER BY created_at, id').all(project.id);
  const { blocks, skipped } = buildDocBlocks(docs);

  // Stable prefix (system + documents + project context) is cached; the growing
  // chat history sits after the breakpoints so follow-up questions reuse the cache.
  const contextMessage = {
    role: 'user',
    content: [
      ...blocks,
      { type: 'text', text: buildContextText(project, quotes, skipped), cache_control: { type: 'ephemeral' } },
    ],
  };
  const chat = messages.slice(-20).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || '').slice(0, 8000),
  }));

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [
        contextMessage,
        { role: 'assistant', content: 'Understood. I have reviewed the project context, the logged quotes, and the attached supplier documents. What would you like to know?' },
        ...chat,
      ],
    });

    if (response.stop_reason === 'refusal') {
      return res.json({ reply: 'I was unable to answer that particular request. Please rephrase your question about the quotes and try again.' });
    }
    const reply = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    res.json({ reply: reply || 'I could not produce an answer — please try rephrasing your question.' });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      return res.status(503).json({ error: 'The AI API key is invalid. Ask an administrator to check ANTHROPIC_API_KEY.' });
    }
    if (e instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: 'The AI service is busy right now — please try again in a minute.' });
    }
    if (e instanceof Anthropic.APIError) {
      console.error('AI error:', e.status, e.message);
      return res.status(502).json({ error: 'The AI service returned an error. Please try again.' });
    }
    throw e;
  }
});

module.exports = router;
