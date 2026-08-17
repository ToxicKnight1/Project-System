const express = require('express');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { db, UPLOAD_DIR } = require('./db');
const { requireAuth, requireOps } = require('./auth');

const router = express.Router();

const MODEL = 'claude-fable-5';
// Fable 5's safety classifiers can decline a request; the server-side fallback
// re-runs it on Anthropic's recommended substitute model in the same call.
const FALLBACK_HEADERS = { 'anthropic-beta': 'server-side-fallback-2026-07-01' };
const MAX_DOC_BYTES = 18 * 1024 * 1024; // stay under the API's 32MB request limit after base64
const HISTORY_LIMIT = 40;

const SYSTEM_PROMPT = `You are the quote comparison assistant inside Central Pharma's project management portal. Operations staff upload supplier quotes and rely on you for logical, measured analysis so they can exercise their own judgment from an accurate picture.

Everything you do centres on THREE decision points, in this order:
1. URS FIT — how closely each quote meets the User Requirement Specification (URS) attached to the project. Express this as an alignment percentage with a one-line justification (e.g. "≈90% in line with the URS — meets all functional requirements but omits the required validation documentation").
2. PRICE — comparable costs in pounds sterling (£), VAT treatment noted, against the project budget where known.
3. TIMELINE — lead time, installation duration, and fit against the project's target date.

Conversation style:
- Keep ordinary replies short and plain — a few sentences or a compact list. Save the depth for the full breakdown, which the user requests explicitly.
- When the conversation opens, greet in one line, confirm which documents you can see (URS, form details, quotes), and ask AT MOST two or three short numbered questions — only about price, timeline, or URS priorities, and only what you genuinely need. Never interrogate; if answers don't come, proceed with stated assumptions.
- If no quote documents are attached, say what is missing and ask for them via the paperclip. If no URS is present, flag that URS-fit scoring cannot be done until it is imported.

Analysis rules:
- Score every quote against the URS requirement by requirement where possible; call out each requirement a supplier fails, excludes, or leaves ambiguous.
- Check quotes cover the same scope before comparing prices; flag mismatches prominently.
- A more expensive supplier with higher URS fit may still be the better choice — say so when the evidence supports it.
- Be explicit about assumptions and missing information; never invent figures. The final judgment rests with the operator.

When the user requests the full breakdown, produce a single comprehensive report with these sections:
1. URS FIT — per supplier: alignment %, requirements met, requirements missed or unclear.
2. PRICE — comparable cost table in £, VAT noted, ranked, set against budget.
3. TIMELINE — lead times and installation duration per supplier vs the target date.
4. RISKS & GAPS — missing information, expiring quotes, assumptions.
5. QUESTIONS TO ASK SUPPLIERS — clarifications worth getting before committing.
6. RECOMMENDATION — which supplier and why across URS fit, price, and timeline, with the runner-up and the conditions under which the runner-up would win.`;

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

function buildFormText(project) {
  const intake = project.intake ? (() => { try { return JSON.parse(project.intake); } catch { return null; } })() : null;
  const items = db.prepare('SELECT * FROM budget_items WHERE project_id = ? ORDER BY id').all(project.id);
  const total = items.reduce((s, i) => s + i.amount, 0);
  const lines = [
    `PROJECT FORM — ${project.name}`,
    project.department && `Department: ${project.department}`,
    project.expense_type && `Expense type: ${project.expense_type}`,
    project.priority_tier && `Priority tier (set by Operations): ${project.priority_tier}`,
    `Status: ${project.approval_status}`,
    project.due_date && `Target date (set by Operations): ${project.due_date}`,
    project.description && `Goal: ${project.description}`,
  ].filter(Boolean);
  if (items.length) {
    lines.push('', 'BUDGET BREAKDOWN:');
    for (const i of items) lines.push(`- ${i.label}: £${i.amount}`);
    lines.push(`- TOTAL: £${total}`);
  } else if (project.budget != null) {
    lines.push(`Budget: £${project.budget}`);
  }
  if (intake) {
    lines.push('', 'FORM ANSWERS:');
    for (const [k, v] of Object.entries(intake)) {
      if (v && String(v).trim()) lines.push(`- ${k}: ${Array.isArray(v) ? v.join(', ') : v}`);
    }
  }
  return lines.join('\n');
}

function buildContextText(project, quotes, skipped) {
  const lines = [buildFormText(project)];
  const ursDoc = project.urs_document_id
    ? db.prepare('SELECT * FROM documents WHERE id = ?').get(project.urs_document_id)
    : null;
  lines.push('', ursDoc
    ? `URS DOCUMENT: "${ursDoc.original_name}" is attached above — score every quote's alignment against it.`
    : 'URS DOCUMENT: none attached yet — URS-fit scoring is not possible until it is provided.');
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
router.post('/projects/:id/ai-chat/start', requireAuth, requireOps, requireConfigured, getProject, async (req, res) => {
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
router.post('/projects/:id/ai-chat', requireAuth, requireOps, requireConfigured, getProject, async (req, res) => {
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
router.post('/projects/:id/ai-chat/breakdown', requireAuth, requireOps, requireConfigured, getProject, async (req, res) => {
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

// Import the project form + URS into the chat as an explicit reference point.
router.post('/projects/:id/ai-chat/import-form', requireAuth, requireOps, requireConfigured, getProject, async (req, res) => {
  const p = req.project;
  const ursDoc = p.urs_document_id ? db.prepare('SELECT * FROM documents WHERE id = ?').get(p.urs_document_id) : null;
  const importText = [
    'FORM / URS IMPORT — use this as the reference baseline for all quote assessment:',
    '',
    buildFormText(p),
    '',
    ursDoc
      ? `The URS document "${ursDoc.original_name}" is attached to this project — treat it as the authoritative requirement specification.`
      : 'NOTE: no URS document is attached yet.',
    '',
    'Confirm in a few lines what you now have on record (form details, URS, and any quotes), and note anything still missing before quotes can be fully assessed.',
  ].join('\n');
  try {
    const reply = await callModel(p, loadHistory(p.id), importText);
    const insert = db.prepare("INSERT INTO ai_messages (project_id, role, kind, content, user_id) VALUES (?, ?, 'chat', ?, ?)");
    insert.run(p.id, 'user', `Imported the project form${ursDoc ? ' and URS' : ''} for reference.`, req.user.id);
    insert.run(p.id, 'assistant', reply, null);
    res.json({ messages: loadHistory(p.id) });
  } catch (e) {
    aiErrorResponse(res, e);
  }
});

// Reset the conversation (the documents and quotes are untouched).
router.delete('/projects/:id/ai-chat', requireAuth, requireOps, getProject, (req, res) => {
  db.prepare('DELETE FROM ai_messages WHERE project_id = ?').run(req.project.id);
  res.json({ ok: true });
});

module.exports = router;
