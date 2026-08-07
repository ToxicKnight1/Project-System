const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { db, UPLOAD_DIR } = require('./db');
const { signToken, requireAuth, requireRole } = require('./auth');

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

// Self-service signup from the login card. The role pills map:
// "admin" -> admin, "operations" -> manager (edit rights, no team management).
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

// Everything below requires a valid login.
router.use(requireAuth);

// ── Dashboard ─────────────────────────────────────────────────────
router.get('/dashboard', (req, res) => {
  const projectsByStatus = db.prepare('SELECT status, COUNT(*) AS n FROM projects GROUP BY status').all();
  const tasksByStatus = db.prepare('SELECT status, COUNT(*) AS n FROM tasks GROUP BY status').all();
  const openTasks = db
    .prepare(`
      SELECT t.*, p.name AS project_name, u.name AS assignee_name
      FROM tasks t
      JOIN projects p ON p.id = t.project_id
      LEFT JOIN users u ON u.id = t.assignee_id
      WHERE t.status != 'done'
      ORDER BY t.due_date IS NULL, t.due_date ASC
      LIMIT 10
    `)
    .all();
  const quoteTotals = db
    .prepare("SELECT status, COUNT(*) AS n, COALESCE(SUM(amount),0) AS total FROM quotes GROUP BY status")
    .all();
  const recentProjects = db
    .prepare(`
      SELECT p.*, u.name AS manager_name,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS done_count
      FROM projects p
      LEFT JOIN users u ON u.id = p.manager_id
      WHERE p.status IN ('planning','active','on_hold')
      ORDER BY p.created_at DESC LIMIT 6
    `)
    .all();
  res.json({ projectsByStatus, tasksByStatus, openTasks, quoteTotals, recentProjects });
});

// ── Users (admin manages; everyone can list for assignee pickers) ─
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

// ── Projects ──────────────────────────────────────────────────────
router.get('/projects', (req, res) => {
  res.json(
    db.prepare(`
      SELECT p.*, u.name AS manager_name,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS done_count,
        (SELECT COALESCE(SUM(amount),0) FROM quotes q WHERE q.project_id = p.id AND q.status = 'accepted') AS accepted_total
      FROM projects p
      LEFT JOIN users u ON u.id = p.manager_id
      ORDER BY p.created_at DESC
    `).all()
  );
});

router.get('/projects/:id', (req, res) => {
  const project = db
    .prepare('SELECT p.*, u.name AS manager_name FROM projects p LEFT JOIN users u ON u.id = p.manager_id WHERE p.id = ?')
    .get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  project.tasks = db
    .prepare('SELECT t.*, u.name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.project_id = ? ORDER BY t.position, t.id')
    .all(project.id);
  project.quotes = db.prepare('SELECT * FROM quotes WHERE project_id = ? ORDER BY quote_date DESC, id DESC').all(project.id);
  project.documents = db
    .prepare('SELECT d.*, u.name AS uploader_name FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by WHERE d.project_id = ? ORDER BY d.created_at DESC')
    .all(project.id);
  res.json(project);
});

router.post('/projects', requireRole('manager'), (req, res) => {
  const { name, client = '', description = '', status = 'planning', start_date = null, due_date = null, budget = null, manager_id = null } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Project name required' });
  const info = db
    .prepare('INSERT INTO projects (name, client, description, status, start_date, due_date, budget, manager_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(name, client, description, status, start_date, due_date, budget, manager_id);
  res.status(201).json(db.prepare('SELECT * FROM projects WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/projects/:id', requireRole('manager'), (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const { name = p.name, client = p.client, description = p.description, status = p.status, start_date = p.start_date, due_date = p.due_date, budget = p.budget, manager_id = p.manager_id } = req.body || {};
  db.prepare('UPDATE projects SET name=?, client=?, description=?, status=?, start_date=?, due_date=?, budget=?, manager_id=? WHERE id=?')
    .run(name, client, description, status, start_date, due_date, budget, manager_id, p.id);
  res.json(db.prepare('SELECT * FROM projects WHERE id = ?').get(p.id));
});

router.delete('/projects/:id', requireRole('admin'), (req, res) => {
  const docs = db.prepare('SELECT stored_name FROM documents WHERE project_id = ?').all(req.params.id);
  const info = db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Project not found' });
  for (const d of docs) fs.rm(path.join(UPLOAD_DIR, d.stored_name), { force: true }, () => {});
  res.json({ ok: true });
});

// ── Tasks ─────────────────────────────────────────────────────────
router.post('/projects/:id/tasks', requireRole('manager'), (req, res) => {
  const { title, description = '', status = 'todo', priority = 'medium', assignee_id = null, due_date = null } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Task title required' });
  const pos = db.prepare('SELECT COALESCE(MAX(position),0)+1 AS p FROM tasks WHERE project_id = ?').get(req.params.id).p;
  const info = db
    .prepare('INSERT INTO tasks (project_id, title, description, status, priority, assignee_id, due_date, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.params.id, title, description, status, priority, assignee_id, due_date, pos);
  res.status(201).json(db.prepare('SELECT t.*, u.name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.id = ?').get(info.lastInsertRowid));
});

router.put('/tasks/:id', requireRole('manager'), (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  const { title = t.title, description = t.description, status = t.status, priority = t.priority, assignee_id = t.assignee_id, due_date = t.due_date, position = t.position } = req.body || {};
  db.prepare('UPDATE tasks SET title=?, description=?, status=?, priority=?, assignee_id=?, due_date=?, position=? WHERE id=?')
    .run(title, description, status, priority, assignee_id, due_date, position, t.id);
  res.json(db.prepare('SELECT t.*, u.name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.id = ?').get(t.id));
});

router.delete('/tasks/:id', requireRole('manager'), (req, res) => {
  const info = db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Task not found' });
  res.json({ ok: true });
});

// ── Quotes ────────────────────────────────────────────────────────
router.post('/projects/:id/quotes', requireRole('manager'), (req, res) => {
  const { vendor, reference = '', amount = 0, status = 'pending', quote_date = null, notes = '' } = req.body || {};
  if (!vendor) return res.status(400).json({ error: 'Vendor name required' });
  const info = db
    .prepare('INSERT INTO quotes (project_id, vendor, reference, amount, status, quote_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(req.params.id, vendor, reference, amount, status, quote_date, notes);
  res.status(201).json(db.prepare('SELECT * FROM quotes WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/quotes/:id', requireRole('manager'), (req, res) => {
  const q = db.prepare('SELECT * FROM quotes WHERE id = ?').get(req.params.id);
  if (!q) return res.status(404).json({ error: 'Quote not found' });
  const { vendor = q.vendor, reference = q.reference, amount = q.amount, status = q.status, quote_date = q.quote_date, notes = q.notes } = req.body || {};
  db.prepare('UPDATE quotes SET vendor=?, reference=?, amount=?, status=?, quote_date=?, notes=? WHERE id=?')
    .run(vendor, reference, amount, status, quote_date, notes, q.id);
  res.json(db.prepare('SELECT * FROM quotes WHERE id = ?').get(q.id));
});

router.delete('/quotes/:id', requireRole('manager'), (req, res) => {
  const info = db.prepare('DELETE FROM quotes WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Quote not found' });
  res.json({ ok: true });
});

// ── Documents ─────────────────────────────────────────────────────
router.post('/projects/:id/documents', requireRole('manager'), upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const info = db
    .prepare('INSERT INTO documents (project_id, stored_name, original_name, mime_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.params.id, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, req.user.id);
  res.status(201).json(db.prepare('SELECT * FROM documents WHERE id = ?').get(info.lastInsertRowid));
});

router.get('/documents/:id/download', (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  res.download(path.join(UPLOAD_DIR, doc.stored_name), doc.original_name);
});

router.delete('/documents/:id', requireRole('manager'), (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id);
  fs.rm(path.join(UPLOAD_DIR, doc.stored_name), { force: true }, () => {});
  res.json({ ok: true });
});

module.exports = router;
