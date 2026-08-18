const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
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

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) =>
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const SYSTEM_PROMPT = `You are the quote comparison assistant inside Central Pharma's project management portal. Operations staff upload supplier quotes and rely on you for logical, measured analysis so they can exercise their own judgment from an accurate picture.

Everything you do centres on THREE decision points, in this order:
1. URS FIT — how closely each quote meets the User Requirement Specification (URS) imported into the chat. Express this as an alignment percentage with a one-line justification (e.g. "≈90% in line with the URS — meets all functional requirements but omits the required validation documentation").
2. PRICE — comparable costs in pounds sterling (£), VAT treatment noted, against the project budget where known.
3. TIMELINE — lead time, installation duration, and fit against the project's target date.

Conversation style:
- Keep ordinary replies short and plain — a few sentences or a compact list. Save depth for when the user asks for a full comparison.
- Ask AT MOST two or three short numbered questions when genuinely needed — only about price, timeline, or URS priorities. Never interrogate; if answers don't come, proceed with stated assumptions.
- If no quote documents are attached, say what is missing and ask for them via the paperclip. If no URS is present, flag that URS-fit scoring cannot be done until a project form is imported.

Analysis rules:
- Score every quote against the URS requirement by requirement where possible; call out each requirement a supplier fails, excludes, or leaves ambiguous.
- Check quotes cover the same scope before comparing prices; flag mismatches prominently.
- A more expensive supplier with higher URS fit may still be the better choice — say so when the evidence supports it. Always give the pros AND cons of every supplier.
- Be explicit about assumptions and missing information; never invent figures. The final judgment rests with the operator.`;

// Convert the chat's uploaded documents into Claude content blocks.
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
    `PROJECT FORM — ${project.reference} · ${project.name}`,
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
      if (k.startsWith('_')) continue;
      if (v && String(v).trim()) lines.push(`- ${k}: ${Array.isArray(v) ? v.join(', ') : v}`);
    }
  }
  return lines.join('\n');
}

function loadHistory() {
  return db
    .prepare('SELECT m.*, u.name AS user_name FROM quote_chat m LEFT JOIN users u ON u.id = m.user_id ORDER BY m.id')
    .all();
}

const docCount = () => db.prepare('SELECT COUNT(*) AS n FROM chat_documents').get().n;

async function callModel(history, latestUserContent) {
  const docs = db.prepare('SELECT * FROM chat_documents ORDER BY created_at, id').all();
  const { blocks, skipped } = buildDocBlocks(docs);

  const contextLines = [
    'The documents attached above were provided in the Compare Quotes chat: supplier quotes uploaded by Operations, plus any imported project forms and URS documents (imported forms appear as text documents named after their reference, e.g. "CP-0003-form.txt").',
  ];
  if (skipped.length) contextLines.push('', `DOCUMENTS THAT COULD NOT BE ATTACHED: ${skipped.join('; ')}`);
  if (!docs.length) contextLines.push('', 'No documents are attached yet.');

  // Stable prefix (system + documents + context) is cached; the growing chat
  // history sits after the breakpoints so follow-up turns reuse the cache.
  const contextMessage = {
    role: 'user',
    content: [
      ...blocks,
      { type: 'text', text: contextLines.join('\n'), cache_control: { type: 'ephemeral' } },
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

// Read the shared conversation.
router.get('/quotes-chat', requireAuth, (req, res) => {
  res.json({
    messages: loadHistory(),
    doc_count: docCount(),
    documents: db.prepare('SELECT id, original_name, created_at FROM chat_documents ORDER BY id').all(),
  });
});

// Project forms eligible for import: approved or completed only.
router.get('/quotes-chat/forms', requireAuth, requireOps, (req, res) => {
  res.json(
    db.prepare(`
      SELECT p.id, p.reference, p.name, p.approval_status, p.urs_document_id,
        u.name AS owner_name, u.department AS owner_department
      FROM projects p LEFT JOIN users u ON u.id = p.owner_id
      WHERE p.approval_status IN ('approved','completed')
      ORDER BY p.id DESC
    `).all()
  );
});

// Upload supplier quote documents into the chat.
router.post('/quotes-chat/documents', requireAuth, requireOps, upload.array('files', 10), (req, res) => {
  if (!req.files || !req.files.length) return res.status(400).json({ error: 'No files uploaded' });
  const insert = db.prepare('INSERT INTO chat_documents (stored_name, original_name, mime_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?)');
  for (const f of req.files) insert.run(f.filename, f.originalname, f.mimetype, f.size, req.user.id);
  res.status(201).json({ doc_count: docCount() });
});

// Send a chat message.
router.post('/quotes-chat', requireAuth, requireOps, requireConfigured, async (req, res) => {
  const text = String((req.body || {}).message || '').trim().slice(0, 12000);
  if (!text) return res.status(400).json({ error: 'Message required' });
  try {
    const reply = await callModel(loadHistory(), text);
    const insert = db.prepare("INSERT INTO quote_chat (role, content, user_id) VALUES (?, ?, ?)");
    insert.run('user', text, req.user.id);
    insert.run('assistant', reply, null);
    res.json({ messages: loadHistory() });
  } catch (e) {
    aiErrorResponse(res, e);
  }
});

// Import a chosen project's form (and its URS) into the chat: the form becomes
// a text document, the URS is attached alongside it.
router.post('/quotes-chat/import/:projectId', requireAuth, requireOps, requireConfigured, async (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.projectId);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  if (!['approved', 'completed'].includes(p.approval_status)) {
    return res.status(400).json({ error: 'Only approved or completed projects can be imported' });
  }
  const insertDoc = db.prepare('INSERT INTO chat_documents (stored_name, original_name, mime_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?)');

  // Form answers as a text document (replacing any earlier import of the same form).
  const formName = `${p.reference}-form.txt`;
  const old = db.prepare('SELECT * FROM chat_documents WHERE original_name = ?').all(formName);
  for (const d of old) {
    db.prepare('DELETE FROM chat_documents WHERE id = ?').run(d.id);
    fs.rm(path.join(UPLOAD_DIR, d.stored_name), { force: true }, () => {});
  }
  const formText = buildFormText(p);
  const stored = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.txt`;
  fs.writeFileSync(path.join(UPLOAD_DIR, stored), formText);
  insertDoc.run(stored, formName, 'text/plain', Buffer.byteLength(formText), req.user.id);

  // The project's URS document rides along (shares the stored file).
  const ursDoc = p.urs_document_id ? db.prepare('SELECT * FROM documents WHERE id = ?').get(p.urs_document_id) : null;
  if (ursDoc) {
    const already = db.prepare('SELECT 1 FROM chat_documents WHERE stored_name = ?').get(ursDoc.stored_name);
    if (!already) insertDoc.run(ursDoc.stored_name, `${p.reference}-URS-${ursDoc.original_name}`, ursDoc.mime_type, ursDoc.size, req.user.id);
  }

  try {
    const trigger = `I have just imported the form for ${p.reference} · ${p.name}${ursDoc ? ' together with its URS document' : ' (no URS attached to it)'}. Confirm in a few lines what you now have on record for it, and note anything still missing before its quotes can be fully assessed.`;
    const reply = await callModel(loadHistory(), trigger);
    const insert = db.prepare("INSERT INTO quote_chat (role, content, user_id) VALUES (?, ?, ?)");
    insert.run('user', `Imported ${p.reference} · ${p.name}${ursDoc ? ' with URS' : ''}.`, req.user.id);
    insert.run('assistant', reply, null);
    res.json({ messages: loadHistory(), doc_count: docCount() });
  } catch (e) {
    aiErrorResponse(res, e);
  }
});

// Reset the chat back to zero: messages and chat documents both cleared.
// Files owned by projects (imported URS copies) are kept on disk.
router.delete('/quotes-chat', requireAuth, requireOps, (req, res) => {
  const docs = db.prepare('SELECT * FROM chat_documents').all();
  db.prepare('DELETE FROM chat_documents').run();
  db.prepare('DELETE FROM quote_chat').run();
  for (const d of docs) {
    const ownedByProject = db.prepare('SELECT 1 FROM documents WHERE stored_name = ?').get(d.stored_name);
    if (!ownedByProject) fs.rm(path.join(UPLOAD_DIR, d.stored_name), { force: true }, () => {});
  }
  res.json({ ok: true });
});

module.exports = router;
