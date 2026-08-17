import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, getToken } from '../api.js';
import { useAuth, ApprovalBadge, TierBadge, fmtMoney, fmtDate } from '../App.jsx';
import CompareChat from './CompareChat.jsx';
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

function Subtasks({ project, canEdit, reload }) {
  const [title, setTitle] = useState('');
  const [subFor, setSubFor] = useState(null); // task id we're adding a subtask under
  const [subTitle, setSubTitle] = useState('');

  const parents = project.tasks.filter((t) => !t.parent_id);
  const childrenOf = (id) => project.tasks.filter((t) => t.parent_id === id);

  const add = async (parent_id, text, clear) => {
    if (!text.trim()) return;
    await api(`/projects/${project.id}/tasks`, { method: 'POST', body: { title: text.trim(), parent_id } });
    clear();
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

  const Row = ({ t, sub }) => (
    <div className={`task-row${sub ? ' sub' : ''}`}>
      <label className="task-check">
        <input type="checkbox" checked={t.status === 'done'} disabled={!canEdit} onChange={() => toggle(t)} />
        <span className={t.status === 'done' ? 'task-done' : ''}>{t.title}</span>
      </label>
      {canEdit && (
        <div className="task-actions">
          {!sub && <button className="btn small" onClick={() => { setSubFor(subFor === t.id ? null : t.id); setSubTitle(''); }}>+ Subtask</button>}
          <button className="btn small danger" onClick={() => remove(t)}>✕</button>
        </div>
      )}
    </div>
  );

  return (
    <div className="detail-card card">
      <h3>Tasks & subtasks</h3>
      {parents.length === 0 && <div className="faint" style={{ padding: '6px 0 12px' }}>No tasks yet.</div>}
      {parents.map((t) => (
        <div key={t.id}>
          <Row t={t} />
          {childrenOf(t.id).map((c) => <Row key={c.id} t={c} sub />)}
          {subFor === t.id && canEdit && (
            <form className="task-add sub" onSubmit={(e) => { e.preventDefault(); add(t.id, subTitle, () => { setSubTitle(''); setSubFor(null); }); }}>
              <input value={subTitle} onChange={(e) => setSubTitle(e.target.value)} placeholder="Subtask…" autoFocus />
              <button className="btn small primary">Add</button>
            </form>
          )}
        </div>
      ))}
      {canEdit && (
        <form className="task-add" onSubmit={(e) => { e.preventDefault(); add(null, title, () => setTitle('')); }}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task…" />
          <button className="btn small primary">Add</button>
        </form>
      )}
    </div>
  );
}

function BudgetBreakdown({ project, isOps, reload }) {
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
          {isOps && ' Add the components below; the total is calculated automatically.'}
        </div>
      ) : (
        <table className="tbl">
          <tbody>
            {project.budget_items.map((i) => (
              <tr key={i.id}>
                <td>{i.label}</td>
                <td className="num">{fmtMoney(i.amount)}</td>
                {isOps && <td className="num" style={{ width: 40 }}><button className="btn small danger" onClick={() => remove(i.id)}>✕</button></td>}
              </tr>
            ))}
            <tr>
              <td><b>Total</b></td>
              <td className="num"><b>{fmtMoney(project.budget_total)}</b></td>
              {isOps && <td />}
            </tr>
          </tbody>
        </table>
      )}
      {isOps && (
        <form className="task-add" onSubmit={add}>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Component, e.g. Racking supply & install" />
          <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="£" style={{ maxWidth: 140 }} />
          <button className="btn small primary">Add</button>
        </form>
      )}
    </div>
  );
}

function Comments({ project, isOps, reload }) {
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
      <h3>Operations comments</h3>
      {project.comments.length === 0 && <div className="faint" style={{ padding: '6px 0 12px' }}>No comments yet.</div>}
      {project.comments.map((c) => (
        <div key={c.id} className="comment">
          <div className="comment-head">{c.user_name || 'Operations'} · <span className="faint">{fmtDate(c.created_at)}</span></div>
          {c.content}
        </div>
      ))}
      {isOps && (
        <form className="task-add" onSubmit={add}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a comment visible to the requester…" />
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
  const [tab, setTab] = useState('form');
  const [err, setErr] = useState('');
  const [editForm, setEditForm] = useState(false);
  const isOps = user.role === 'manager';
  const isOwner = project && project.owner_id === user.id;
  const canEdit = isOps || (user.role === 'admin' && isOwner && project?.approval_status !== 'completed');

  const load = () => api(`/projects/${id}`).then(setProject).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [id]);

  if (err) return <div className="form-err">{err}</div>;
  if (!project) return <div className="muted">Loading…</div>;

  const intake = project.intake ? (() => { try { return JSON.parse(project.intake); } catch { return null; } })() : null;
  const ursDoc = project.urs_document_id ? project.documents.find((d) => d.id === project.urs_document_id) : null;

  const opsUpdate = async (body) => {
    await api(`/projects/${id}/ops`, { method: 'PUT', body });
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
      <div className="page-head">
        <div>
          <div className="faint" style={{ fontSize: '0.76rem', marginBottom: 4 }}>
            <a onClick={() => navigate('/projects')} style={{ cursor: 'pointer' }}>Projects</a> / {project.name}
          </div>
          <h1 style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {project.name} <ApprovalBadge value={project.approval_status} /> <TierBadge value={project.priority_tier} />
          </h1>
          <div className="page-sub">
            {[project.department, project.owner_name && `Raised by ${project.owner_name}`, project.due_date && `Due ${fmtDate(project.due_date)}`]
              .filter(Boolean).join(' · ')}
          </div>
        </div>
        {canEdit && <button className="btn" onClick={() => setEditForm(true)}>Edit form</button>}
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
            <select value={project.approval_status} onChange={(e) => opsUpdate({ approval_status: e.target.value })}>
              <option value="awaiting_approval">Awaiting approval</option>
              <option value="approved">Approved</option>
              <option value="completed">Completed</option>
            </select>
            <select value={project.priority_tier || ''} onChange={(e) => opsUpdate({ priority_tier: e.target.value })}>
              <option value="">Priority tier…</option>
              {TIERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input type="date" value={project.due_date || ''} onChange={(e) => opsUpdate({ due_date: e.target.value || null })} title="Due date" />
          </div>
        </div>
      )}

      <div className="tab-nav">
        <button className={`tab-btn${tab === 'form' ? ' active' : ''}`} onClick={() => setTab('form')}>Form Details</button>
        {isOps && <button className={`tab-btn${tab === 'compare' ? ' active' : ''}`} onClick={() => setTab('compare')}>✦ Compare Quotes</button>}
      </div>

      <div className="tab-body">
        {tab === 'form' && (
          <div className="detail-grid">
            <div className="detail-card card">
              <h3>Project form</h3>
              <table className="tbl form-tbl">
                <tbody>
                  <tr><td>Project name</td><td>{project.name}</td></tr>
                  {intake && Object.entries(intake).map(([k, v]) => {
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
              <Subtasks project={project} canEdit={canEdit} reload={load} />
              <BudgetBreakdown project={project} isOps={isOps} reload={load} />
              <Comments project={project} isOps={isOps} reload={load} />
            </div>
          </div>
        )}

        {tab === 'compare' && isOps && (
          <CompareChat projectId={project.id} docCount={project.documents.length} hasUrs={!!ursDoc} onDocsChanged={load} />
        )}
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
