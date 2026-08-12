const express = require('express');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { db, UPLOAD_DIR } = require('./db');
const { requireAuth, requireRole } = require('./auth');

const router = express.Router();

const MODEL = 'claude-fable-5';
// Fable 5's safety classifiers can decline a request; the server-side fallback
// re-runs it on Anthropic's recommended substitute model in the same call.
const FALLBACK_HEADERS = { 'anthropic-beta': 'server-side-fallback-2026-07-01' };
const MAX_DOC_BYTES = 18 * 1024 * 1024; // stay under the API's 32MB request limit after base64
const HISTORY_LIMIT = 40;

const SYSTEM_PROMPT = `You are the quote comparison assistant inside Central Pharma's project management portal. Operations staff upload supplier quotes and rely on you for logical, measured analysis so they can exercise their own judgment from an accurate picture.

Conversation style:
- This is a chat with busy operations staff. Keep ordinary replies short and plain — a few sentences or a compact list. Save the depth for the full breakdown, which the user requests explicitly.
- At the start of a conversation, after a one-line greeting that names the project, ask AT MOST four short questions in a single message to establish the decision picture: what matters most to them (price, speed, quality, reliability), any hard deadline, any must-have requirements or exclusions, and how firm the budget is. Number the questions so they are easy to answer in one reply.
- Never interrogate. If the user answers only some questions, or says to just get on with it, proceed and state your working assumptions instead of asking again.
- If no quote documents are attached yet, say so and ask them to attach the supplier quotes using the paperclip in this chat (or the Documents tab).

Analysis rules:
- Check whether quotes cover the same scope before comparing prices. Flag any scope mismatch prominently (e.g. one supplier quoting fewer work areas, excluded services, different specifications, different deck heights or footprints).
- List pros AND cons for every supplier, covering price, scope coverage, timeline/installation speed, exclusions, warranties, payment terms, and reliability/reputation where evidenced in the documents. A more expensive supplier may still be the better choice — say so when the evidence supports it.
- Use pounds sterling (£) for all amounts. Note VAT treatment when quotes differ on it.
- Be explicit about assumptions, missing information, and what the operator should clarify with suppliers before deciding.
- Give a reasoned recommendation when asked, but make clear the final judgment rests with the operator.
- Only draw on the project context and documents provided; never invent figures. If the documents don't contain something, say so.

When the user requests the full breakdown, produce a single comprehensive report with these sections, using plain headings and short tables or bullet lists:
1. SCOPE CHECK — are the quotes like-for-like? List every mismatch.
2. COST COMPARISON — a table of comparable costs in £, with VAT treatment noted.
3. SUPPLIER PROFILES — pros and cons for each supplier.
4. RISKS & GAPS — missing information, expiring quotes, assumptions each supplier makes.
5. QUESTIONS TO ASK SUPPLIERS — the clarifications worth getting before committing.
6. RECOMMENDATION — which supplier and why, weighted by the user's stated priorities, with the runner-up and the conditions under which the runner-up would win.`;

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
  lines.push('', 'The supplier quote documents uploaded for this project are attached above (if any).');
  return lines.join('\n');
}

function loadHistory(projectId) {
  return db
    .prepare(`
      SELECT m.*, u.name AS user_name FROM ai_messages m
      LEFT JOIN users u ON u.id = m.user_id
      WHERE m.project_id = ? ORDER BY m.id
    `)
    .all(projectId);
}

async function callModel(project, history, latestUserContent) {
  const quotes = db.prepare('SELECT * FROM quotes WHERE project_id = ? ORDER BY quote_date, id').all(project.id);
  const docs = db.prepare('SELECT * FROM documents WHERE project_id = ? ORDER BY created_at, id').all(project.id);
  const { blocks, skipped } = buildDocBlocks(docs);

  // Stable prefix (system + documents + project context) is cached; the growing
  // chat history sits after the breakpoints so follow-up turns reuse the cache.
  const contextMessage = {
    role: 'user',
    content: [
      ...blocks,
      { type: 'text', text: buildContextText(project, quotes, skipped), cache_control: { type: 'ephemeral' } },
    ],
  };
  const chat = history.slice(-HISTORY_LIMIT).map((m) => ({
    role: m.role,
    content: String(m.content || '').slice(0, 12000),
  }));
  chat.push({ role: 'user', content: latestUserContent });

  const client = new Anthropic();
  const response = await client.messages.create(
    {
      model: MODEL,
      max_tokens: 16000,
      fallbacks: 'default',
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [contextMessage, ...chat],
    },
    { headers: FALLBACK_HEADERS },
  );

  if (response.stop_reason === 'refusal') {
    return 'I was unable to answer that particular request. Please rephrase your question about the quotes and try again.';
  }
  const reply = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  return reply || 'I could not produce an answer — please try rephrasing your question.';
}

function aiErrorResponse(res, e) {
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

function requireConfigured(req, res, next) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error: 'AI comparison is not configured yet. An administrator needs to add the ANTHROPIC_API_KEY environment variable on the server.',
    });
  }
  next();
}

function getProject(req, res, next) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  req.project = project;
  next();
}

// Everyone signed in can read the shared conversation.
router.get('/projects/:id/ai-chat', requireAuth, getProject, (req, res) => {
  res.json({ messages: loadHistory(req.project.id) });
});

// Opens the conversation: the assistant greets and asks its short question set.
router.post('/projects/:id/ai-chat/start', requireAuth, requireRole('manager'), requireConfigured, getProject, async (req, res) => {
  const existing = loadHistory(req.project.id);
  if (existing.length > 0) return res.json({ messages: existing });
  try {
    const reply = await callModel(
      req.project,
      [],
      'Open the conversation: greet me in one line, note in one line what quote documents and logged quotes you can currently see for this project, then ask your short numbered questions (maximum four) to establish my decision priorities.',
    );
    db.prepare("INSERT INTO ai_messages (project_id, role, kind, content) VALUES (?, 'assistant', 'chat', ?)").run(req.project.id, reply);
    res.json({ messages: loadHistory(req.project.id) });
  } catch (e) {
    aiErrorResponse(res, e);
  }
});

// Send a chat message.
router.post('/projects/:id/ai-chat', requireAuth, requireRole('manager'), requireConfigured, getProject, async (req, res) => {
  const text = String((req.body || {}).message || '').trim().slice(0, 12000);
  if (!text) return res.status(400).json({ error: 'Message required' });
  try {
    const reply = await callModel(req.project, loadHistory(req.project.id), text);
    const insert = db.prepare("INSERT INTO ai_messages (project_id, role, kind, content, user_id) VALUES (?, ?, 'chat', ?, ?)");
    insert.run(req.project.id, 'user', text, req.user.id);
    insert.run(req.project.id, 'assistant', reply, null);
    res.json({ messages: loadHistory(req.project.id) });
  } catch (e) {
    aiErrorResponse(res, e);
  }
});

// Generate the comprehensive breakdown.
router.post('/projects/:id/ai-chat/breakdown', requireAuth, requireRole('manager'), requireConfigured, getProject, async (req, res) => {
  const trigger = 'Please generate the full supplier comparison breakdown now, following the six-section structure. Use everything discussed in this conversation plus the attached documents and logged quotes. Where I have not stated a priority, use balanced weighting and say so.';
  try {
    const reply = await callModel(req.project, loadHistory(req.project.id), trigger);
    const insert = db.prepare("INSERT INTO ai_messages (project_id, role, kind, content, user_id) VALUES (?, ?, ?, ?, ?)");
    insert.run(req.project.id, 'user', 'chat', 'Generate the full breakdown', req.user.id);
    insert.run(req.project.id, 'assistant', 'breakdown', reply, null);
    res.json({ messages: loadHistory(req.project.id) });
  } catch (e) {
    aiErrorResponse(res, e);
  }
});

// Reset the conversation (the documents and quotes are untouched).
router.delete('/projects/:id/ai-chat', requireAuth, requireRole('manager'), getProject, (req, res) => {
  db.prepare('DELETE FROM ai_messages WHERE project_id = ?').run(req.project.id);
  res.json({ ok: true });
});

module.exports = router;
