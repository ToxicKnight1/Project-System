import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth, Badge, fmtDate, fmtMoney } from '../App.jsx';
import IntakeWizard from './IntakeWizard.jsx';

const EMPTY = { name: '', client: '', description: '', status: 'planning', start_date: '', due_date: '', budget: '', manager_id: '' };

export function ProjectForm({ initial, users, onSave, onClose }) {
  const [form, setForm] = useState({ ...EMPTY, ...initial, budget: initial?.budget ?? '', manager_id: initial?.manager_id ?? '' });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    try {
      await onSave({
        ...form,
        budget: form.budget === '' ? null : Number(form.budget),
        manager_id: form.manager_id === '' ? null : Number(form.manager_id),
        start_date: form.start_date || null,
        due_date: form.due_date || null,
      });
    } catch (e2) {
      setErr(e2.message);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{initial?.id ? 'Edit project' : 'New project'}</h2>
        {err && <div className="form-err">{err}</div>}
        <div className="field"><label>Name</label><input value={form.name} onChange={set('name')} required autoFocus /></div>
        <div className="form-row">
          <div className="field"><label>Client</label><input value={form.client} onChange={set('client')} /></div>
          <div className="field"><label>Status</label>
            <select value={form.status} onChange={set('status')}>
              <option value="planning">Planning</option>
              <option value="active">Active</option>
              <option value="on_hold">On hold</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="field"><label>Start date</label><input type="date" value={form.start_date || ''} onChange={set('start_date')} /></div>
          <div className="field"><label>Due date</label><input type="date" value={form.due_date || ''} onChange={set('due_date')} /></div>
        </div>
        <div className="form-row">
          <div className="field"><label>Budget (USD)</label><input type="number" min="0" step="0.01" value={form.budget} onChange={set('budget')} /></div>
          <div className="field"><label>Project manager</label>
            <select value={form.manager_id} onChange={set('manager_id')}>
              <option value="">— Unassigned —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        </div>
        <div className="field"><label>Description</label><textarea rows={3} value={form.description} onChange={set('description')} /></div>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">{initial?.id ? 'Save changes' : 'Create project'}</button>
        </div>
      </form>
    </div>
  );
}

export default function Projects() {
  const { user } = useAuth();
  const [projects, setProjects] = useState(null);
  const [users, setUsers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [err, setErr] = useState('');
  const navigate = useNavigate();
  const canEdit = user.role !== 'viewer';

  const load = () => {
    api('/projects').then(setProjects).catch((e) => setErr(e.message));
    api('/users').then((all) => setUsers(all.filter((u) => u.active))).catch(() => {});
  };
  useEffect(load, []);

  const create = async (body) => {
    const p = await api('/projects', { method: 'POST', body });
    setShowForm(false);
    navigate(`/projects/${p.id}`);
  };

  if (err) return <div className="form-err">{err}</div>;
  if (!projects) return <div className="muted">Loading…</div>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Projects</h1>
          <div className="page-sub">{projects.length} total</div>
        </div>
        {canEdit && <button className="btn primary" onClick={() => setShowForm(true)}>+ New project</button>}
      </div>

      <div className="card" style={{ padding: '8px 20px' }}>
        {projects.length === 0 ? (
          <div className="empty">No projects yet.</div>
        ) : (
          <table className="tbl">
            <thead>
              <tr><th>Project</th><th>Status</th><th>Manager</th><th>Tasks</th><th className="num">Budget</th><th className="num">Accepted quotes</th><th>Due</th></tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => navigate(`/projects/${p.id}`)}>
                  <td><b>{p.name}</b><div className="faint" style={{ fontSize: '0.74rem' }}>{p.client}</div></td>
                  <td><Badge value={p.status} /></td>
                  <td className="muted">{p.manager_name || '—'}</td>
                  <td className="muted">{p.done_count}/{p.task_count}</td>
                  <td className="num muted">{fmtMoney(p.budget)}</td>
                  <td className="num muted">{fmtMoney(p.accepted_total)}</td>
                  <td className="faint">{fmtDate(p.due_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showForm && <IntakeWizard onSave={create} onClose={() => setShowForm(false)} />}
    </>
  );
}
