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
- Ask AT MOST two or three short numbered questions when genuinely needed — only about price, timeline, or URS priorities (e.g. "Is the stated budget within your aim for this purchase, or is there flexibility?"). Never interrogate; if answers don't come, proceed with stated assumptions.
- If no quote documents are attached, say what is missing and ask for them via the paperclip. If no URS is present, flag that URS-fit scoring cannot be done until a project form is imported.

Analysis rules:
- Score every quote against the URS requirement by requirement where possible; call out each requirement a supplier fails, excludes, or leaves ambiguous.
- Check quotes cover the same scope before comparing prices; flag mismatches prominently.
- A more expensive supplier with higher URS fit may still be the better choice — say so when the evidence supports it. Always give the pros AND cons of every supplier.
- Be explicit about assumptions and missing information; never invent figures. The final judgment rests with the operator.`;

// Convert the chat's uploaded documents into Claude content blocks.
// .docx files (a common URS format) get their text extracted so the model can
// read them alongside PDFs, images, and plain text.
async function buildDocBlocks(docs) {
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
    if (ext === '.docx') {
      try {
        const mammoth = require('mammoth');
        const { value } = await mammoth.extractRawText({ path: filePath });
        if (value && value.trim()) {
          blocks.push({
            type: 'document',
            source: { type: 'text', media_type: 'text/plain', data: value.slice(0, 200000) },
            title: d.original_name,
          });
        } else {
          skipped.push(`${d.original_name} (no readable text found in the document)`);
        }
      } catch (err) {
        skipped.push(`${d.original_name} (could not extract text: ${err.message})`);
      }
      continue;
    }
    if (ext !== '.pdf' && !imageTypes[ext] && !isText) {
      skipped.push(`${d.original_name} (unsupported format — upload PDF, image, text, or .docx)`);
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

function loadHistory(sessionId) {
  return db
    .prepare('SELECT m.*, u.name AS user_name FROM quote_chat m LEFT JOIN users u ON u.id = m.user_id WHERE m.session_id = ? ORDER BY m.id')
    .all(sessionId);
}

const docCount = (sessionId) =>
  db.prepare('SELECT COUNT(*) AS n FROM chat_documents WHERE session_id = ?').get(sessionId).n;

async function callModel(sessionId, history, latestUserContent) {
  const docs = db.prepare('SELECT * FROM chat_documents WHERE session_id = ? ORDER BY created_at, id').all(sessionId);
  const { blocks, skipped } = await buildDocBlocks(docs);

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

// ── Chat sessions ─────────────────────────────────────────────────
function getSession(req, res) {
  const sess = db.prepare('SELECT * FROM quote_sessions WHERE id = ?').get(req.params.sid);
  if (!sess) {
    res.status(404).json({ error: 'Chat not found' });
    return null;
  }
  return sess;
}

// The chat history log: every session, open and closed.
router.get('/quotes-sessions', requireAuth, requireOps, (req, res) => {
  res.json(
    db.prepare(`
      SELECT s.*, u.name AS created_by_name,
        (SELECT COUNT(*) FROM quote_chat m WHERE m.session_id = s.id) AS message_count,
        (SELECT MAX(created_at) FROM quote_chat m WHERE m.session_id = s.id) AS last_message_at
      FROM quote_sessions s LEFT JOIN users u ON u.id = s.created_by
      ORDER BY s.status = 'closed', COALESCE(last_message_at, s.created_at) DESC
    `).all()
  );
});

router.post('/quotes-sessions', requireAuth, requireOps, (req, res) => {
  const info = db.prepare('INSERT INTO quote_sessions (created_by) VALUES (?)').run(req.user.id);
  res.status(201).json(db.prepare('SELECT * FROM quote_sessions WHERE id = ?').get(info.lastInsertRowid));
});

router.get('/quotes-sessions/:sid', requireAuth, (req, res) => {
  const sess = getSession(req, res);
  if (!sess) return;
  res.json({
    session: sess,
    messages: loadHistory(sess.id),
    doc_count: docCount(sess.id),
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

function requireOpen(sess, res) {
  if (sess.status !== 'open') {
    res.status(400).json({ error: 'This chat is closed' });
    return false;
  }
  return true;
}

// Upload supplier quote documents into a chat.
router.post('/quotes-sessions/:sid/documents', requireAuth, requireOps, upload.array('files', 10), (req, res) => {
  const sess = getSession(req, res);
  if (!sess || !requireOpen(sess, res)) return;
  if (!req.files || !req.files.length) return res.status(400).json({ error: 'No files uploaded' });
  const insert = db.prepare('INSERT INTO chat_documents (session_id, stored_name, original_name, mime_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)');
  for (const f of req.files) insert.run(sess.id, f.filename, f.originalname, f.mimetype, f.size, req.user.id);
  res.status(201).json({ doc_count: docCount(sess.id) });
});

// Send a chat message.
router.post('/quotes-sessions/:sid/message', requireAuth, requireOps, requireConfigured, async (req, res) => {
  const sess = getSession(req, res);
  if (!sess || !requireOpen(sess, res)) return;
  const text = String((req.body || {}).message || '').trim().slice(0, 12000);
  if (!text) return res.status(400).json({ error: 'Message required' });
  try {
    const reply = await callModel(sess.id, loadHistory(sess.id), text);
    const insert = db.prepare('INSERT INTO quote_chat (session_id, role, content, user_id) VALUES (?, ?, ?, ?)');
    insert.run(sess.id, 'user', text, req.user.id);
    insert.run(sess.id, 'assistant', reply, null);
    res.json({ messages: loadHistory(sess.id) });
  } catch (e) {
    aiErrorResponse(res, e);
  }
});

// Import a chosen project's form (and its URS). One form per chat: once a
// form is in, the chat is locked to it and further imports are refused.
router.post('/quotes-sessions/:sid/import/:projectId', requireAuth, requireOps, requireConfigured, async (req, res) => {
  const sess = getSession(req, res);
  if (!sess || !requireOpen(sess, res)) return;
  if (sess.project_id) return res.status(400).json({ error: 'A form is already imported into this chat — start a new chat for another form' });
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.projectId);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  if (!['approved', 'completed'].includes(p.approval_status)) {
    return res.status(400).json({ error: 'Only approved or completed projects can be imported' });
  }
  const insertDoc = db.prepare('INSERT INTO chat_documents (session_id, stored_name, original_name, mime_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)');

  const formText = buildFormText(p);
  const stored = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.txt`;
  fs.writeFileSync(path.join(UPLOAD_DIR, stored), formText);
  insertDoc.run(sess.id, stored, `${p.reference}-form.txt`, 'text/plain', Buffer.byteLength(formText), req.user.id);

  // The project's URS document rides along (shares the stored file).
  const ursDoc = p.urs_document_id ? db.prepare('SELECT * FROM documents WHERE id = ?').get(p.urs_document_id) : null;
  if (ursDoc) {
    insertDoc.run(sess.id, ursDoc.stored_name, `${p.reference}-URS-${ursDoc.original_name}`, ursDoc.mime_type, ursDoc.size, req.user.id);
  }

  // The chat takes the form's reference as its label and locks to it.
  db.prepare('UPDATE quote_sessions SET project_id = ?, title = ? WHERE id = ?')
    .run(p.id, `${p.reference} · ${p.name}`, sess.id);

  try {
    const trigger = `I have just imported the form for ${p.reference} · ${p.name}${ursDoc ? ' together with its URS document' : ' (no URS attached to it)'}. Confirm in a few lines what you now have on record for it, and note anything still missing before its quotes can be fully assessed.`;
    const reply = await callModel(sess.id, loadHistory(sess.id), trigger);
    const insert = db.prepare('INSERT INTO quote_chat (session_id, role, content, user_id) VALUES (?, ?, ?, ?)');
    insert.run(sess.id, 'user', `Imported ${p.reference} · ${p.name}${ursDoc ? ' with URS' : ''}.`, req.user.id);
    insert.run(sess.id, 'assistant', reply, null);
    res.json({
      session: db.prepare('SELECT * FROM quote_sessions WHERE id = ?').get(sess.id),
      messages: loadHistory(sess.id),
      doc_count: docCount(sess.id),
    });
  } catch (e) {
    aiErrorResponse(res, e);
  }
});

// Close a chat (kept in the history log, read-only).
router.post('/quotes-sessions/:sid/close', requireAuth, requireOps, (req, res) => {
  const sess = getSession(req, res);
  if (!sess) return;
  db.prepare("UPDATE quote_sessions SET status = 'closed' WHERE id = ?").run(sess.id);
  res.json({ ok: true });
});

// Delete a chat entirely: messages and documents go with it.
// Files owned by projects (imported URS copies) are kept on disk.
router.delete('/quotes-sessions/:sid', requireAuth, requireOps, (req, res) => {
  const sess = getSession(req, res);
  if (!sess) return;
  const docs = db.prepare('SELECT * FROM chat_documents WHERE session_id = ?').all(sess.id);
  db.prepare('DELETE FROM chat_documents WHERE session_id = ?').run(sess.id);
  db.prepare('DELETE FROM quote_chat WHERE session_id = ?').run(sess.id);
  db.prepare('DELETE FROM quote_sessions WHERE id = ?').run(sess.id);
  for (const d of docs) {
    const ownedByProject = db.prepare('SELECT 1 FROM documents WHERE stored_name = ?').get(d.stored_name);
    if (!ownedByProject) fs.rm(path.join(UPLOAD_DIR, d.stored_name), { force: true }, () => {});
  }
  res.json({ ok: true });
});

module.exports = router;
