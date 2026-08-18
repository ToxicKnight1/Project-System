import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, getToken } from '../api.js';
import { useAuth, ApprovalBadge, TierBadge, fmtMoney, fmtDate } from '../App.jsx';
import IntakeWizard from './IntakeWizard.jsx';

const TIERS = [
  ['critical', 'Critical'],
  ['urgent', 'Urgent'],
  ['important', 'Important'],
  ['routine', 'Routine'],
  ['desirable', 'Desirable'],
];

function downloadDoc(doc) {
  fetch(`/api/documents/${doc.id}/download`, { headers: { Authorization: `Bearer ${getToken()}` } })
    .then((r) => (r.ok ? r.blob() : Promise.reject()))
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.original_name;
      a.click();
      URL.revokeObjectURL(url);
    })
    .catch(() => alert('Download failed'));
}

function Tasks({ project, canContribute, reload }) {
  const [title, setTitle] = useState('');

  const add = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    await api(`/projects/${project.id}/tasks`, { method: 'POST', body: { title: title.trim() } });
    setTitle('');
    reload();
  };
  const toggle = async (t) => {
    await api(`/tasks/${t.id}`, { method: 'PUT', body: { done: t.status !== 'done' } });
    reload();
  };
  const remove = async (t) => {
    await api(`/tasks/${t.id}`, { method: 'DELETE' });
    reload();
  };

  return (
    <div className="detail-card card">
      <h3>Tasks</h3>
      {project.tasks.length === 0 && (
        <div className="faint" style={{ padding: '6px 0 12px' }}>No tasks yet.</div>
      )}
      {project.tasks.map((t) => (
        <div key={t.id} className="task-row">
          <label className="task-check">
            <input type="checkbox" checked={t.status === 'done'} disabled={!canContribute} onChange={() => toggle(t)} />
            <span className={t.status === 'done' ? 'task-done' : ''}>{t.title}</span>
          </label>
          {canContribute && (
            <div className="task-actions">
              <button className="btn small danger" onClick={() => remove(t)}>✕</button>
            </div>
          )}
        </div>
      ))}
      {canContribute && (
        <form className="task-add" onSubmit={add}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task…" />
          <button className="btn small primary">Add</button>
        </form>
      )}
    </div>
  );
}

function BudgetBreakdown({ project, canContribute, reload }) {
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');

  const add = async (e) => {
    e.preventDefault();
    if (!label.trim() || !amount) return;
    await api(`/projects/${project.id}/budget-items`, { method: 'POST', body: { label, amount: Number(amount) } });
    setLabel('');
    setAmount('');
    reload();
  };
  const remove = async (id) => {
    await api(`/budget-items/${id}`, { method: 'DELETE' });
    reload();
  };

  return (
    <div className="detail-card card">
      <h3>Budget breakdown</h3>
      {project.budget_items.length === 0 ? (
        <div className="faint" style={{ padding: '6px 0 12px' }}>
          No components yet{project.budget != null ? ` — the requester estimated ${fmtMoney(project.budget)}.` : '.'}
        </div>
      ) : (
        <table className="tbl">
          <tbody>
            {project.budget_items.map((i) => (
              <tr key={i.id}>
                <td>{i.label}</td>
                <td className="num">{fmtMoney(i.amount)}</td>
                {canContribute && <td className="num" style={{ width: 40 }}><button className="btn small danger" onClick={() => remove(i.id)}>✕</button></td>}
              </tr>
            ))}
            <tr>
              <td><b>Total</b></td>
              <td className="num"><b>{fmtMoney(project.budget_total)}</b></td>
              {canContribute && <td />}
            </tr>
          </tbody>
        </table>
      )}
      {canContribute && (
        <form className="task-add" onSubmit={add}>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Component, e.g. Racking supply & install" />
          <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="£" style={{ maxWidth: 140 }} />
          <button className="btn small primary">Add</button>
        </form>
      )}
    </div>
  );
}

function Comments({ project, canContribute, reload }) {
  const [text, setText] = useState('');
  const add = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    await api(`/projects/${project.id}/comments`, { method: 'POST', body: { content: text.trim() } });
    setText('');
    reload();
  };
  return (
    <div className="detail-card card">
      <h3>Comments</h3>
      {project.comments.length === 0 && <div className="faint" style={{ padding: '6px 0 12px' }}>No comments yet.</div>}
      {project.comments.map((c) => (
        <div key={c.id} className="comment">
          <div className="comment-head">{c.user_name || 'Operations'} · <span className="faint">{fmtDate(c.created_at)}</span></div>
          {c.content}
        </div>
      ))}
      {canContribute && (
        <form className="task-add" onSubmit={add}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a comment or reply…" />
          <button className="btn small primary">Post</button>
        </form>
      )}
    </div>
  );
}

export default function ProjectDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [err, setErr] = useState('');
  const [editForm, setEditForm] = useState(false);
  const [siblings, setSiblings] = useState([]);
  const isOps = user.role === 'manager';
  const isOwner = project && project.owner_id === user.id;
  // The form belongs to its author; Operations contribute but do not edit it.
  const canEdit = isOwner && project?.approval_status !== 'completed';
  const canContribute = isOps || isOwner;
  const home = isOps ? '/dashboard' : '/projects';

  const load = () => api(`/projects/${id}`).then(setProject).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [id]);

  // Sibling project ids (drafts excluded — they open in the wizard, not here)
  // so the ← / → buttons can step from project form to project form.
  useEffect(() => {
    api('/projects')
      .then((list) => setSiblings(list.filter((p) => p.approval_status !== 'draft').map((p) => p.id)))
      .catch(() => {});
  }, []);
  const idx = siblings.indexOf(Number(id));
  const prevId = idx > 0 ? siblings[idx - 1] : null;
  const nextId = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;

  if (err) return <div className="form-err">{err}</div>;
  if (!project) return <div className="muted">Loading…</div>;

  const intake = project.intake ? (() => { try { return JSON.parse(project.intake); } catch { return null; } })() : null;
  const ursDoc = project.urs_document_id ? project.documents.find((d) => d.id === project.urs_document_id) : null;
  const author = project.owner_name
    ? `Raised by ${project.owner_name}${project.owner_department ? ` · ${project.owner_department}` : ''}`
    : null;

  const opsUpdate = async (body) => {
    await api(`/projects/${id}/ops`, { method: 'PUT', body });
    load();
  };

  const approve = async () => {
    if (!window.confirm(`Approve "${project.name}" (${project.reference})? The requester will be notified.`)) return;
    await opsUpdate({ approval_status: 'approved' });
  };

  const markCompleted = async () => {
    if (!window.confirm(`Mark "${project.name}" as completed?`)) return;
    await api(`/projects/${id}/complete`, { method: 'POST' });
    load();
  };

  const uploadUrs = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    await api(`/projects/${id}/documents?urs=1`, { method: 'POST', formData: fd });
    load();
  };

  return (
    <>
      <div className="dash-bg" />
      <div className="page-head">
        <div>
          <div className="faint" style={{ fontSize: '0.76rem', marginBottom: 4 }}>
            <a onClick={() => navigate(home)} style={{ cursor: 'pointer' }}>← Back</a> / {project.reference} · {project.name}
          </div>
          <h1>{project.name}</h1>
          <div className="page-sub">
            {[project.reference, project.department !== project.owner_department && project.department, author].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <ApprovalBadge value={project.approval_status} />
          <TierBadge value={project.priority_tier} />
          {project.due_date && <span className="muted" style={{ fontSize: '0.82rem' }}>Due {fmtDate(project.due_date)}</span>}
          {isOps && project.approval_status === 'awaiting_approval' && (
            <button className="btn approve" onClick={approve}>✓ Approve</button>
          )}
          {canContribute && project.approval_status === 'approved' && (
            <button className="btn" onClick={markCompleted}>Mark completed</button>
          )}
          <button className="btn" disabled={!prevId} title="Previous project" onClick={() => navigate(`/projects/${prevId}`)}>←</button>
          <button className="btn" disabled={!nextId} title="Next project" onClick={() => navigate(`/projects/${nextId}`)}>→</button>
          {canEdit && <button className="btn" onClick={() => setEditForm(true)}>Edit form</button>}
        </div>
      </div>

      <div className="grid cols-4" style={{ marginBottom: 22 }}>
        <div className="stat-tile"><div className="label">Status</div><div className="value" style={{ fontSize: '1.1rem' }}><ApprovalBadge value={project.approval_status} /></div></div>
        <div className="stat-tile">
          <div className="label">Budget total</div>
          <div className="value">{fmtMoney(project.budget_items.length ? project.budget_total : project.budget)}</div>
          {project.budget_items.length > 0 && <div className="sub">{project.budget_items.length} components</div>}
        </div>
        <div className="stat-tile">
          <div className="label">URS</div>
          <div className="value" style={{ fontSize: '1.1rem' }}>{ursDoc ? '✅ Attached' : '⚠️ Missing'}</div>
        </div>
        <div className="stat-tile"><div className="label">Due date</div><div className="value" style={{ fontSize: '1.2rem' }}>{fmtDate(project.due_date)}</div></div>
      </div>

      {isOps && (
        <div className="card ops-panel" style={{ marginBottom: 22 }}>
          <b style={{ fontSize: '0.85rem' }}>Operations controls</b>
          <div className="ops-controls" style={{ marginTop: 10 }}>
            <select value={project.priority_tier || ''} onChange={(e) => opsUpdate({ priority_tier: e.target.value })}>
              <option value="">Priority tier…</option>
              {TIERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input type="date" value={project.due_date || ''} onChange={(e) => opsUpdate({ due_date: e.target.value || null })} title="Due date" />
          </div>
        </div>
      )}

      <div className="detail-grid">
        <div className="detail-card card">
          <h3>Project form</h3>
          <table className="tbl form-tbl">
            <tbody>
              <tr><td>Reference</td><td>{project.reference}</td></tr>
              <tr><td>Project name</td><td>{project.name}</td></tr>
              {intake && Object.entries(intake).map(([k, v]) => {
                if (k.startsWith('_')) return null;
                const value = Array.isArray(v) ? v.join(', ') : v;
                if (!value || !String(value).trim()) return null;
                return <tr key={k}><td>{k}</td><td>{value}</td></tr>;
              })}
              <tr>
                <td>URS document *</td>
                <td>
                  {ursDoc ? (
                    <a style={{ cursor: 'pointer' }} onClick={() => downloadDoc(ursDoc)}>📄 {ursDoc.original_name}</a>
                  ) : (
                    <span className="badge red">Missing — required</span>
                  )}
                  {canEdit && (
                    <label className="btn small" style={{ marginLeft: 10, cursor: 'pointer' }}>
                      {ursDoc ? 'Replace' : 'Attach URS'}
                      <input type="file" style={{ display: 'none' }} accept=".pdf,.doc,.docx,.txt,.md" onChange={uploadUrs} />
                    </label>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <Tasks project={project} canContribute={canContribute} reload={load} />
          <BudgetBreakdown project={project} canContribute={canContribute} reload={load} />
          <Comments project={project} canContribute={canContribute} reload={load} />
        </div>
      </div>

      {editForm && (
        <IntakeWizard
          existing={project}
          onDone={() => { setEditForm(false); load(); }}
          onClose={() => setEditForm(false)}
        />
      )}
    </>
  );
}
