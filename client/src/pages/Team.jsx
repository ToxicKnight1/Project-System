import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth, Badge } from '../App.jsx';

const ROLE_BADGE = { admin: 'red', manager: 'blue', viewer: 'gray' };

function UserForm({ initial, onSave, onClose }) {
  const [form, setForm] = useState({
    name: '', email: '', role: 'viewer', job_title: '', password: '', active: 1,
    ...initial,
    password: '',
  });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    try {
      const body = { ...form };
      if (initial?.id && !body.password) delete body.password;
      await onSave(body);
    } catch (e2) { setErr(e2.message); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{initial?.id ? 'Edit member' : 'Add team member'}</h2>
        {err && <div className="form-err">{err}</div>}
        <div className="form-row">
          <div className="field"><label>Name</label><input value={form.name} onChange={set('name')} required autoFocus /></div>
          <div className="field"><label>Job title</label><input value={form.job_title} onChange={set('job_title')} /></div>
        </div>
        <div className="field"><label>Email</label><input type="email" value={form.email} onChange={set('email')} required /></div>
        <div className="form-row">
          <div className="field"><label>Role</label>
            <select value={form.role} onChange={set('role')}>
              <option value="viewer">Viewer (read-only)</option>
              <option value="manager">Manager (can edit)</option>
              <option value="admin">Admin (full control)</option>
            </select>
          </div>
          <div className="field"><label>{initial?.id ? 'New password (optional)' : 'Password'}</label>
            <input type="password" value={form.password} onChange={set('password')} minLength={8} required={!initial?.id} placeholder={initial?.id ? 'Leave blank to keep' : 'Min 8 characters'} />
          </div>
        </div>
        {initial?.id && (
          <div className="field"><label>Status</label>
            <select value={form.active} onChange={(e) => setForm({ ...form, active: Number(e.target.value) })}>
              <option value={1}>Active</option>
              <option value={0}>Deactivated (cannot sign in)</option>
            </select>
          </div>
        )}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">Save</button>
        </div>
      </form>
    </div>
  );
}

export default function Team() {
  const { user } = useAuth();
  const [users, setUsers] = useState(null);
  const [modal, setModal] = useState(null); // null | 'new' | user object
  const [err, setErr] = useState('');
  const isAdmin = user.role === 'admin';

  const load = () => api('/users').then(setUsers).catch((e) => setErr(e.message));
  useEffect(load, []);

  const save = async (body) => {
    if (modal === 'new') await api('/users', { method: 'POST', body });
    else await api(`/users/${modal.id}`, { method: 'PUT', body });
    setModal(null);
    load();
  };

  if (err) return <div className="form-err">{err}</div>;
  if (!users) return <div className="muted">Loading…</div>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Team</h1>
          <div className="page-sub">{users.filter((u) => u.active).length} active members</div>
        </div>
        {isAdmin && <button className="btn primary" onClick={() => setModal('new')}>+ Add member</button>}
      </div>

      <div className="card" style={{ padding: '8px 20px' }}>
        <table className="tbl">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th>{isAdmin && <th></th>}</tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td><b>{u.name}</b><div className="faint" style={{ fontSize: '0.74rem' }}>{u.job_title}</div></td>
                <td className="muted">{u.email}</td>
                <td><span className={`badge ${ROLE_BADGE[u.role]}`}>{u.role}</span></td>
                <td>{u.active ? <span className="badge green">Active</span> : <span className="badge gray">Deactivated</span>}</td>
                {isAdmin && <td className="num"><button className="btn small" onClick={() => setModal(u)}>Edit</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && <UserForm initial={modal === 'new' ? null : modal} onSave={save} onClose={() => setModal(null)} />}
    </>
  );
}
