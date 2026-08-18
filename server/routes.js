const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { db, UPLOAD_DIR } = require('./db');
const { signToken, requireAuth, requireRole, requireOps } = require('./auth');

const router = express.Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) =>
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// ── Auth ──────────────────────────────────────────────────────────
router.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const user = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  res.json({
    token: signToken(user),
    user: { id: user.id, name: user.name, email: user.email, role: user.role, job_title: user.job_title },
  });
});

// Lets the login card shift the Operations/Admin pill to the account's actual
// side as soon as a known email is typed. Only exposes the role, nothing else.
router.post('/auth/lookup', (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.json({ role: null });
  const user = db.prepare('SELECT role FROM users WHERE email = ? AND active = 1').get(email);
  res.json({ role: user ? user.role : null });
});

// Self-service signup from the login card. The role pills map:
// "admin" -> admin (requester: raises project forms), "operations" -> manager (operational control).
router.post('/auth/register', (req, res) => {
  const { name, email, password, role = 'operations', job_title = '', department = '' } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const dbRole = role === 'admin' ? 'admin' : 'manager';
  try {
    const info = db
      .prepare('INSERT INTO users (name, email, password_hash, role, job_title, department) VALUES (?, ?, ?, ?, ?, ?)')
      .run(name, email, bcrypt.hashSync(password, 10), dbRole, job_title, department);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({
      token: signToken(user),
      user: { id: user.id, name: user.name, email: user.email, role: user.role, job_title: user.job_title, department: user.department },
    });
  } catch (e) {
    if (String(e).includes('UNIQUE')) return res.status(409).json({ error: 'An account with this email already exists' });
    throw e;
  }
});

router.get('/auth/me', requireAuth, (req, res) => {
  const user = db
    .prepare('SELECT id, name, email, role, job_title, department FROM users WHERE id = ? AND active = 1')
    .get(req.user.id);
  if (!user) return res.status(401).json({ error: 'Account disabled' });
  res.json(user);
});

router.post('/auth/change-password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!new_password || new_password.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(current_password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(new_password, 10), user.id);
  res.json({ ok: true });
});

// Crash reports from the frontend error boundary (no auth — a crash can happen
// pre-login). Trimmed hard so it cannot be abused as storage.
router.post('/client-error', (req, res) => {
  const b = req.body || {};
  db.prepare('INSERT INTO client_errors (message, stack, url, user_agent) VALUES (?, ?, ?, ?)').run(
    String(b.message || 'unknown').slice(0, 500),
    String(b.stack || '').slice(0, 4000),
    String(b.url || '').slice(0, 300),
    String(req.headers['user-agent'] || '').slice(0, 300),
  );
  res.json({ ok: true });
});

// Everything below requires a valid login.
router.use(requireAuth);

router.get('/client-errors', requireOps, (req, res) => {
  res.json(db.prepare('SELECT * FROM client_errors ORDER BY id DESC LIMIT 50').all());
});

// ── Visibility helpers ────────────────────────────────────────────
// Operations and viewers see every submitted project; admins (requesters)
// see only their own. Drafts are private to their owner.
function projectVisible(user, p) {
  if (p.approval_status === 'draft') return p.owner_id === user.id;
  if (user.role === 'admin') return p.owner_id === user.id;
  return true;
}

function getVisibleProject(req, res) {
  const p = db
    .prepare('SELECT p.*, u.name AS owner_name, u.department AS owner_department FROM projects p LEFT JOIN users u ON u.id = p.owner_id WHERE p.id = ?')
    .get(req.params.id);
  if (!p || !projectVisible(req.user, p)) {
    res.status(404).json({ error: 'Project not found' });
    return null;
  }
  return p;
}

// The form itself belongs to its author — Operations cannot edit someone
// else's form, only contribute (tasks, budget components, comments).
function canEditProject(user, p) {
  return p.owner_id === user.id && p.approval_status !== 'completed';
}

// Tasks and budget components are open to Operations and the form's author.
function canContribute(user, p) {
  return user.role === 'manager' || p.owner_id === user.id;
}

function notify(userId, content, projectId) {
  if (!userId) return;
  db.prepare('INSERT INTO notifications (user_id, content, project_id) VALUES (?, ?, ?)').run(userId, content, projectId || null);
}

// Notify every active Operations user (except the actor themselves).
function notifyOps(content, projectId, exceptUserId) {
  const ops = db.prepare("SELECT id FROM users WHERE role = 'manager' AND active = 1").all();
  for (const u of ops) if (u.id !== exceptUserId) notify(u.id, content, projectId);
}

const budgetTotal = (projectId) =>
  db.prepare('SELECT COALESCE(SUM(amount),0) AS t FROM budget_items WHERE project_id = ?').get(projectId).t;

// ── Dashboard (operations only) ───────────────────────────────────
router.get('/dashboard', requireOps, (req, res) => {
  const all = db
    .prepare(`
      SELECT p.*, u.name AS owner_name, u.department AS owner_department,
        (SELECT COALESCE(SUM(amount),0) FROM budget_items b WHERE b.project_id = p.id) AS budget_total
      FROM projects p LEFT JOIN users u ON u.id = p.owner_id
      WHERE p.approval_status != 'draft'
      ORDER BY p.created_at DESC
    `)
    .all();
  res.json({
    awaiting: all.filter((p) => p.approval_status === 'awaiting_approval'),
    approved: all.filter((p) => p.approval_status === 'approved'),
    completed: all.filter((p) => p.approval_status === 'completed'),
    completed_count: all.filter((p) => p.approval_status === 'completed').length,
  });
});

// ── Users ─────────────────────────────────────────────────────────
router.get('/users', (req, res) => {
  res.json(
    db.prepare('SELECT id, name, email, role, job_title, department, active, created_at FROM users ORDER BY name').all()
  );
});

router.post('/users', requireRole('admin'), (req, res) => {
  const { name, email, password, role = 'viewer', job_title = '' } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const info = db
      .prepare('INSERT INTO users (name, email, password_hash, role, job_title) VALUES (?, ?, ?, ?, ?)')
      .run(name, email, bcrypt.hashSync(password, 10), role, job_title);
    res.status(201).json(db.prepare('SELECT id, name, email, role, job_title, active FROM users WHERE id = ?').get(info.lastInsertRowid));
  } catch (e) {
    if (String(e).includes('UNIQUE')) return res.status(409).json({ error: 'Email already in use' });
    throw e;
  }
});

router.put('/users/:id', requireRole('admin'), (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { name = user.name, email = user.email, role = user.role, job_title = user.job_title, active = user.active, password } = req.body || {};
  if (user.id === req.user.id && (role !== 'admin' || !active)) {
    return res.status(400).json({ error: 'You cannot demote or deactivate your own account' });
  }
  db.prepare('UPDATE users SET name = ?, email = ?, role = ?, job_title = ?, active = ? WHERE id = ?')
    .run(name, email, role, job_title, active ? 1 : 0, user.id);
  if (password) {
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), user.id);
  }
  res.json(db.prepare('SELECT id, name, email, role, job_title, active FROM users WHERE id = ?').get(user.id));
});

// ── Notifications ─────────────────────────────────────────────────
router.get('/notifications', (req, res) => {
  res.json(
    db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 30').all(req.user.id)
  );
});

router.post('/notifications/read', (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

// ── Projects ──────────────────────────────────────────────────────
router.get('/projects', (req, res) => {
  const rows = db
    .prepare(`
      SELECT p.*, u.name AS owner_name, u.department AS owner_department,
        (SELECT COALESCE(SUM(amount),0) FROM budget_items b WHERE b.project_id = p.id) AS budget_total
      FROM projects p LEFT JOIN users u ON u.id = p.owner_id
      ORDER BY p.created_at DESC
    `)
    .all()
    .filter((p) => projectVisible(req.user, p));
  res.json(rows);
});

router.get('/projects/:id', (req, res) => {
  const project = getVisibleProject(req, res);
  if (!project) return;
  project.tasks = db
    .prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY COALESCE(parent_id, id), id')
    .all(project.id);
  project.documents = db
    .prepare('SELECT d.*, u.name AS uploader_name FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by WHERE d.project_id = ? ORDER BY d.created_at DESC')
    .all(project.id);
  project.budget_items = db.prepare('SELECT * FROM budget_items WHERE project_id = ? ORDER BY id').all(project.id);
  project.budget_total = budgetTotal(project.id);
  project.comments = db
    .prepare('SELECT c.*, u.name AS user_name FROM comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.project_id = ? ORDER BY c.id DESC')
    .all(project.id);
  res.json(project);
});

// Create (or draft) a project form. Admins and operations can raise forms;
// priority and due date are operations-controlled and ignored here.
function replaceBudgetComponents(projectId, components) {
  if (!Array.isArray(components)) return;
  db.prepare('DELETE FROM budget_items WHERE project_id = ?').run(projectId);
  const insert = db.prepare('INSERT INTO budget_items (project_id, label, amount) VALUES (?, ?, ?)');
  for (const c of components) {
    const label = String(c.label || '').trim();
    const amount = Number(c.amount);
    if (label && Number.isFinite(amount) && amount >= 0) insert.run(projectId, label, amount);
  }
}

router.post('/projects', requireRole('manager'), (req, res) => {
  const {
    name, description = '', department = '', expense_type = '', intake = null,
    draft = false, budget = null, budget_components,
  } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Project name required' });
  const info = db
    .prepare(`INSERT INTO projects (name, description, department, expense_type, intake, owner_id, approval_status, budget, status)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planning')`)
    .run(name, description, department, expense_type, intake ? JSON.stringify(intake) : '', req.user.id,
      draft ? 'draft' : 'awaiting_approval', budget);
  db.prepare("UPDATE projects SET reference = 'CP-' || printf('%04d', id) WHERE id = ?").run(info.lastInsertRowid);
  replaceBudgetComponents(info.lastInsertRowid, budget_components);
  const created = db.prepare('SELECT * FROM projects WHERE id = ?').get(info.lastInsertRowid);
  if (!draft && req.user.role !== 'manager') {
    notifyOps(`${req.user.name} submitted a new project form: "${created.name}" (${created.reference}).`, created.id, req.user.id);
  }
  res.status(201).json(created);
});

// Update the form content (owner while not completed, or operations).
router.put('/projects/:id', (req, res) => {
  const p = getVisibleProject(req, res);
  if (!p) return;
  if (!canEditProject(req.user, p)) return res.status(403).json({ error: 'You cannot edit this project' });
  const { name = p.name, description = p.description, department = p.department, expense_type = p.expense_type, budget = p.budget } = req.body || {};
  const intake = req.body && req.body.intake !== undefined ? JSON.stringify(req.body.intake) : p.intake;
  const draft = req.body && req.body.draft !== undefined ? !!req.body.draft : null;
  let approval = p.approval_status;
  if (draft !== null && p.approval_status === 'draft' && !draft) approval = 'awaiting_approval';
  db.prepare('UPDATE projects SET name=?, description=?, department=?, expense_type=?, budget=?, intake=?, approval_status=? WHERE id=?')
    .run(name, description, department, expense_type, budget, intake, approval, p.id);
  if (req.body && req.body.budget_components !== undefined) replaceBudgetComponents(p.id, req.body.budget_components);
  // Keep Operations in the loop when a requester submits or changes a form.
  if (req.user.role !== 'manager') {
    if (p.approval_status === 'draft' && approval === 'awaiting_approval') {
      notifyOps(`${req.user.name} submitted a new project form: "${name}" (${p.reference}).`, p.id, req.user.id);
    } else if (approval !== 'draft') {
      notifyOps(`${req.user.name} updated their form "${name}" (${p.reference}).`, p.id, req.user.id);
    }
  }
  res.json(db.prepare('SELECT * FROM projects WHERE id = ?').get(p.id));
});

// Operations controls: approval status, priority tier, due date, start date.
const TIERS = ['critical', 'urgent', 'important', 'routine', 'desirable'];
router.put('/projects/:id/ops', requireOps, (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const body = req.body || {};
  const priority_tier = body.priority_tier !== undefined ? body.priority_tier : p.priority_tier;
  if (priority_tier && !TIERS.includes(priority_tier)) return res.status(400).json({ error: 'Invalid priority tier' });
  const due_date = body.due_date !== undefined ? body.due_date : p.due_date;
  const start_date = body.start_date !== undefined ? body.start_date : p.start_date;
  let approval_status = p.approval_status;
  if (body.approval_status !== undefined) {
    if (!['awaiting_approval', 'approved', 'completed'].includes(body.approval_status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    approval_status = body.approval_status;
  }
  db.prepare('UPDATE projects SET priority_tier=?, due_date=?, start_date=?, approval_status=? WHERE id=?')
    .run(priority_tier || '', due_date, start_date, approval_status, p.id);
  if (approval_status !== p.approval_status && p.owner_id) {
    const label = approval_status === 'approved' ? 'approved' : approval_status === 'completed' ? 'marked as completed' : 'moved back to awaiting approval';
    notify(p.owner_id, `Your project "${p.name}" has been ${label} by Operations.`, p.id);
  }
  res.json(db.prepare('SELECT * FROM projects WHERE id = ?').get(p.id));
});

// Once approved, both Operations and the form's author can mark it completed.
router.post('/projects/:id/complete', (req, res) => {
  const p = getVisibleProject(req, res);
  if (!p) return;
  if (!canContribute(req.user, p)) return res.status(403).json({ error: 'Not allowed' });
  if (p.approval_status !== 'approved') return res.status(400).json({ error: 'Only approved projects can be marked completed' });
  db.prepare("UPDATE projects SET approval_status = 'completed' WHERE id = ?").run(p.id);
  if (p.owner_id && p.owner_id !== req.user.id) {
    notify(p.owner_id, `Your project "${p.name}" has been marked as completed.`, p.id);
  }
  res.json(db.prepare('SELECT * FROM projects WHERE id = ?').get(p.id));
});

router.delete('/projects/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const ownDraft = req.user.role === 'admin' && p.owner_id === req.user.id && p.approval_status === 'draft';
  if (req.user.role !== 'manager' && !ownDraft) return res.status(403).json({ error: 'Operations access required' });
  const docs = db.prepare('SELECT stored_name FROM documents WHERE project_id = ?').all(p.id);
  db.prepare('DELETE FROM projects WHERE id = ?').run(p.id);
  for (const d of docs) fs.rm(path.join(UPLOAD_DIR, d.stored_name), { force: true }, () => {});
  res.json({ ok: true });
});

// ── Tasks (operations and the form's author) ──────────────────────
router.post('/projects/:id/tasks', (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  if (!canContribute(req.user, p)) return res.status(403).json({ error: 'Not allowed' });
  const { title } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Title required' });
  const info = db
    .prepare("INSERT INTO tasks (project_id, title, status) VALUES (?, ?, 'todo')")
    .run(p.id, String(title).trim());
  res.status(201).json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/tasks/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  const proj = db.prepare('SELECT * FROM projects WHERE id = ?').get(t.project_id);
  if (!canContribute(req.user, proj)) return res.status(403).json({ error: 'Not allowed' });
  const { title = t.title, done } = req.body || {};
  const status = done === undefined ? t.status : done ? 'done' : 'todo';
  db.prepare('UPDATE tasks SET title=?, status=? WHERE id=?').run(title, status, t.id);
  res.json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(t.id));
});

router.delete('/tasks/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  const proj = db.prepare('SELECT * FROM projects WHERE id = ?').get(t.project_id);
  if (!canContribute(req.user, proj)) return res.status(403).json({ error: 'Not allowed' });
  db.prepare('DELETE FROM tasks WHERE id = ?').run(t.id);
  res.json({ ok: true });
});

// ── Budget components (operations and the form's author) ──────────
router.post('/projects/:id/budget-items', (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  if (!canContribute(req.user, p)) return res.status(403).json({ error: 'Not allowed' });
  const { label, amount } = req.body || {};
  if (!label || !String(label).trim()) return res.status(400).json({ error: 'Component name required' });
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) return res.status(400).json({ error: 'Valid amount required' });
  db.prepare('INSERT INTO budget_items (project_id, label, amount) VALUES (?, ?, ?)').run(p.id, String(label).trim(), value);
  res.status(201).json({
    items: db.prepare('SELECT * FROM budget_items WHERE project_id = ? ORDER BY id').all(p.id),
    total: budgetTotal(p.id),
  });
});

router.delete('/budget-items/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM budget_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const proj = db.prepare('SELECT * FROM projects WHERE id = ?').get(item.project_id);
  if (!canContribute(req.user, proj)) return res.status(403).json({ error: 'Not allowed' });
  db.prepare('DELETE FROM budget_items WHERE id = ?').run(item.id);
  res.json({
    items: db.prepare('SELECT * FROM budget_items WHERE project_id = ? ORDER BY id').all(item.project_id),
    total: budgetTotal(item.project_id),
  });
});

// ── Comments (Operations and the form's author; each notifies the other) ──
router.post('/projects/:id/comments', (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  if (!canContribute(req.user, p)) return res.status(403).json({ error: 'Not allowed' });
  const content = String((req.body || {}).content || '').trim();
  if (!content) return res.status(400).json({ error: 'Comment required' });
  db.prepare('INSERT INTO comments (project_id, user_id, content) VALUES (?, ?, ?)').run(p.id, req.user.id, content);
  if (req.user.role === 'manager') {
    if (p.owner_id && p.owner_id !== req.user.id) {
      notify(p.owner_id, `Operations commented on "${p.name}": ${content.slice(0, 120)}`, p.id);
    }
  } else {
    notifyOps(`${req.user.name} replied on "${p.name}" (${p.reference}): ${content.slice(0, 120)}`, p.id, req.user.id);
  }
  res.status(201).json(
    db.prepare('SELECT c.*, u.name AS user_name FROM comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.project_id = ? ORDER BY c.id DESC').all(p.id)
  );
});

// ── Documents (owner admin + operations; ?urs=1 marks the URS) ────
router.post('/projects/:id/documents', upload.single('file'), (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p || !projectVisible(req.user, p)) return res.status(404).json({ error: 'Project not found' });
  if (!canEditProject(req.user, p)) return res.status(403).json({ error: 'You cannot edit this project' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const info = db
    .prepare('INSERT INTO documents (project_id, stored_name, original_name, mime_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(p.id, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, req.user.id);
  if (req.query.urs === '1') {
    db.prepare('UPDATE projects SET urs_document_id = ? WHERE id = ?').run(info.lastInsertRowid, p.id);
  }
  res.status(201).json(db.prepare('SELECT * FROM documents WHERE id = ?').get(info.lastInsertRowid));
});

router.get('/documents/:id/download', (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  res.download(path.join(UPLOAD_DIR, doc.stored_name), doc.original_name);
});

router.delete('/documents/:id', requireOps, (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id);
  db.prepare('UPDATE projects SET urs_document_id = NULL WHERE urs_document_id = ?').run(doc.id);
  fs.rm(path.join(UPLOAD_DIR, doc.stored_name), { force: true }, () => {});
  res.json({ ok: true });
});

// ── Monthly report (operations only): PDF with grand budget total ─
router.get('/reports/monthly', requireOps, (req, res) => {
  const PDFDocument = require('pdfkit');
  const rows = db
    .prepare(`
      SELECT p.*, u.name AS owner_name, u.department AS owner_department,
        (SELECT COALESCE(SUM(amount),0) FROM budget_items b WHERE b.project_id = p.id) AS budget_total
      FROM projects p LEFT JOIN users u ON u.id = p.owner_id
      WHERE p.approval_status != 'draft'
      ORDER BY p.created_at
    `)
    .all();
  const money = (n) => `£${Number(n || 0).toLocaleString('en-GB')}`;
  const grandTotal = rows.reduce((s, p) => s + (p.budget_total || p.budget || 0), 0);
  const stamp = new Date().toISOString().slice(0, 10);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="monthly-report-${stamp}.pdf"`);
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
  doc.pipe(res);

  const navy = '#221a66';
  doc.fillColor(navy).fontSize(20).font('Helvetica-Bold').text('Central Pharma — Monthly Project Report');
  doc.fillColor('#51637f').fontSize(10).font('Helvetica').text(`Generated ${stamp} · ${rows.length} project${rows.length === 1 ? '' : 's'}`);
  doc.moveDown(1.2);

  const cols = [
    ['Ref', 60], ['Project', 130], ['Raised by', 110], ['Dept', 80], ['Type', 70],
    ['Status', 90], ['Priority', 65], ['Due date', 70], ['Budget', 85],
  ];
  const startX = doc.page.margins.left;
  const drawRow = (cells, opts = {}) => {
    const y = doc.y;
    let x = startX;
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(opts.color || '#1f2a44');
    cells.forEach((cell, i) => {
      doc.text(String(cell == null ? '' : cell), x, y, { width: cols[i][1] - 6, lineBreak: false, ellipsis: true });
      x += cols[i][1];
    });
    doc.y = y + 16;
    doc.x = startX;
  };
  const rule = () => {
    doc.moveTo(startX, doc.y - 4).lineTo(startX + cols.reduce((s, c) => s + c[1], 0), doc.y - 4)
      .strokeColor('#b9cfe8').lineWidth(0.5).stroke();
  };

  drawRow(cols.map((c) => c[0]), { bold: true, color: navy });
  rule();
  const statusLabel = { awaiting_approval: 'Awaiting approval', approved: 'Approved', completed: 'Completed' };
  for (const p of rows) {
    if (doc.y > doc.page.height - 70) {
      doc.addPage();
      drawRow(cols.map((c) => c[0]), { bold: true, color: navy });
      rule();
    }
    drawRow([
      p.reference, p.name,
      p.owner_name ? `${p.owner_name}${p.owner_department ? ` (${p.owner_department})` : ''}` : '',
      p.department, p.expense_type, statusLabel[p.approval_status] || p.approval_status,
      p.priority_tier, p.due_date || '—', money(p.budget_total || p.budget),
    ]);
    rule();
  }

  doc.moveDown(1);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(navy)
    .text(`Grand total of all budgeted costs: ${money(grandTotal)}`, startX);
  doc.end();
});

module.exports = router;
