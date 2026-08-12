import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth, Badge, fmtDate, fmtMoney } from '../App.jsx';
import { ProjectForm } from './Projects.jsx';
import CompareChat from './CompareChat.jsx';

const KANBAN_COLS = [
  ['todo', 'To do'],
  ['in_progress', 'In progress'],
  ['done', 'Done'],
];

function TaskForm({ initial, users, onSave, onClose }) {
  const [form, setForm] = useState({
    title: '', description: '', status: 'todo', priority: 'medium',
    ...initial,
    assignee_id: initial?.assignee_id ?? '',
    due_date: initial?.due_date ?? '',
  });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    try {
      await onSave({ ...form, assignee_id: form.assignee_id === '' ? null : Number(form.assignee_id), due_date: form.due_date || null });
    } catch (e2) { setErr(e2.message); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{initial?.id ? 'Edit task' : 'New task'}</h2>
        {err && <div className="form-err">{err}</div>}
        <div className="field"><label>Title</label><input value={form.title} onChange={set('title')} required autoFocus /></div>
        <div className="form-row">
          <div className="field"><label>Status</label>
            <select value={form.status} onChange={set('status')}>
              {KANBAN_COLS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="field"><label>Priority</label>
            <select value={form.priority} onChange={set('priority')}>
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="field"><label>Assignee</label>
            <select value={form.assignee_id} onChange={set('assignee_id')}>
              <option value="">— Unassigned —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div className="field"><label>Due date</label><input type="date" value={form.due_date || ''} onChange={set('due_date')} /></div>
        </div>
        <div className="field"><label>Description</label><textarea rows={3} value={form.description} onChange={set('description')} /></div>
        <div className="actions">
          {initial?.id && <button type="button" className="btn danger" onClick={() => onSave(null)}>Delete</button>}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">Save</button>
        </div>
      </form>
    </div>
  );
}

function QuoteForm({ initial, onSave, onClose }) {
  const [form, setForm] = useState({
    vendor: '', reference: '', status: 'pending', notes: '',
    ...initial,
    amount: initial?.amount ?? '',
    quote_date: initial?.quote_date ?? '',
  });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    try {
      await onSave({ ...form, amount: Number(form.amount || 0), quote_date: form.quote_date || null });
    } catch (e2) { setErr(e2.message); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{initial?.id ? 'Edit quote' : 'New quote'}</h2>
        {err && <div className="form-err">{err}</div>}
        <div className="form-row">
          <div className="field"><label>Vendor</label><input value={form.vendor} onChange={set('vendor')} required autoFocus /></div>
          <div className="field"><label>Reference #</label><input value={form.reference} onChange={set('reference')} /></div>
        </div>
        <div className="form-row">
          <div className="field"><label>Amount (USD)</label><input type="number" min="0" step="0.01" value={form.amount} onChange={set('amount')} required /></div>
          <div className="field"><label>Status</label>
            <select value={form.status} onChange={set('status')}>
              <option value="pending">Pending</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option>
            </select>
          </div>
        </div>
        <div className="field"><label>Quote date</label><input type="date" value={form.quote_date || ''} onChange={set('quote_date')} /></div>
        <div className="field"><label>Notes</label><textarea rows={2} value={form.notes} onChange={set('notes')} /></div>
        <div className="actions">
          {initial?.id && <button type="button" className="btn danger" onClick={() => onSave(null)}>Delete</button>}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">Save</button>
        </div>
      </form>
    </div>
  );
}

export default function ProjectDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [users, setUsers] = useState([]);
  const [tab, setTab] = useState('tasks');
  const [err, setErr] = useState('');
  const [taskModal, setTaskModal] = useState(null); // null | 'new' | task object
  const [quoteModal, setQuoteModal] = useState(null);
  const [editProject, setEditProject] = useState(false);
  const [dragOver, setDragOver] = useState(null);
  const fileRef = useRef();
  const canEdit = user.role !== 'viewer';

  const load = () => api(`/projects/${id}`).then(setProject).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
    api('/users').then((all) => setUsers(all.filter((u) => u.active))).catch(() => {});
  }, [id]);

  if (err) return <div className="form-err">{err}</div>;
  if (!project) return <div className="muted">Loading…</div>;

  const saveTask = async (body) => {
    if (body === null) await api(`/tasks/${taskModal.id}`, { method: 'DELETE' });
    else if (taskModal === 'new') await api(`/projects/${id}/tasks`, { method: 'POST', body });
    else await api(`/tasks/${taskModal.id}`, { method: 'PUT', body });
    setTaskModal(null);
    load();
  };

  const saveQuote = async (body) => {
    if (body === null) await api(`/quotes/${quoteModal.id}`, { method: 'DELETE' });
    else if (quoteModal === 'new') await api(`/projects/${id}/quotes`, { method: 'POST', body });
    else await api(`/quotes/${quoteModal.id}`, { method: 'PUT', body });
    setQuoteModal(null);
    load();
  };

  const saveProject = async (body) => {
    await api(`/projects/${id}`, { method: 'PUT', body });
    setEditProject(false);
    load();
  };

  const dropTask = async (e, status) => {
    e.preventDefault();
    setDragOver(null);
    const taskId = e.dataTransfer.getData('text/task-id');
    if (!taskId) return;
    const task = project.tasks.find((t) => t.id === Number(taskId));
    if (!task || task.status === status) return;
    await api(`/tasks/${taskId}`, { method: 'PUT', body: { status } });
    load();
  };

  const uploadFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api(`/projects/${id}/documents`, { method: 'POST', formData: fd });
      load();
    } catch (e2) {
      setErr(e2.message);
    }
    e.target.value = '';
  };

  const deleteDoc = async (docId) => {
    if (!confirm('Delete this document?')) return;
    await api(`/documents/${docId}`, { method: 'DELETE' });
    load();
  };

  const acceptedTotal = project.quotes.filter((q) => q.status === 'accepted').reduce((s, q) => s + q.amount, 0);
  const doneCount = project.tasks.filter((t) => t.status === 'done').length;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="faint" style={{ fontSize: '0.76rem', marginBottom: 4 }}>
            <a onClick={() => navigate('/projects')} style={{ cursor: 'pointer' }}>Projects</a> / {project.name}
          </div>
          <h1>{project.name} <Badge value={project.status} /> {project.priority && <Badge value={project.priority} />}</h1>
          <div className="page-sub">
            {project.client && <>{project.client} · </>}
            {project.manager_name ? `PM: ${project.manager_name}` : 'No manager assigned'} · {fmtDate(project.start_date)} → {fmtDate(project.due_date)}
          </div>
        </div>
        {canEdit && <button className="btn" onClick={() => setEditProject(true)}>Edit project</button>}
      </div>

      <div className="grid cols-4" style={{ marginBottom: 22 }}>
        <div className="stat-tile"><div className="label">Tasks done</div><div className="value">{doneCount}/{project.tasks.length}</div></div>
        <div className="stat-tile"><div className="label">Budget</div><div className="value">{fmtMoney(project.budget)}</div></div>
        <div className="stat-tile">
          <div className="label">Accepted quotes</div><div className="value">{fmtMoney(acceptedTotal)}</div>
          {project.budget != null && (
            <div className="sub">{acceptedTotal > project.budget ? 'Over budget' : `${fmtMoney(project.budget - acceptedTotal)} remaining`}</div>
          )}
        </div>
        <div className="stat-tile"><div className="label">Documents</div><div className="value">{project.documents.length}</div></div>
      </div>

      {project.description && <div className="card" style={{ marginBottom: 22, fontSize: '0.87rem', color: 'var(--text-muted)' }}>{project.description}</div>}

      <div className="tab-nav">
        {[
          ['tasks', `Tasks (${project.tasks.length})`],
          ['quotes', `Quotes (${project.quotes.length})`],
          ['documents', `Documents (${project.documents.length})`],
          ...(canEdit ? [['compare', '✦ Compare Quotes (AI)']] : []),
          ['details', 'Details'],
        ].map(([t, label]) => (
          <button key={t} className={`tab-btn${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </div>

      <div className="tab-body">
        {tab === 'tasks' && (
          <>
            {canEdit && <button className="btn primary small" style={{ marginBottom: 14 }} onClick={() => setTaskModal('new')}>+ Add task</button>}
            <div className="kanban">
              {KANBAN_COLS.map(([status, label]) => {
                const col = project.tasks.filter((t) => t.status === status);
                return (
                  <div
                    key={status}
                    className={`kanban-col${dragOver === status ? ' drag-over' : ''}`}
                    onDragOver={(e) => { if (canEdit) { e.preventDefault(); setDragOver(status); } }}
                    onDragLeave={() => setDragOver(null)}
                    onDrop={(e) => canEdit && dropTask(e, status)}
                  >
                    <h3>{label}<span>{col.length}</span></h3>
                    {col.map((t) => (
                      <div
                        key={t.id}
                        className="task-card"
                        draggable={canEdit}
                        onDragStart={(e) => e.dataTransfer.setData('text/task-id', String(t.id))}
                        onClick={() => canEdit && setTaskModal(t)}
                      >
                        <div className="t-title">{t.title}</div>
                        <div className="t-meta">
                          <Badge value={t.priority} />
                          {t.assignee_name && <span>{t.assignee_name}</span>}
                          {t.due_date && <span>due {fmtDate(t.due_date)}</span>}
                        </div>
                      </div>
                    ))}
                    {col.length === 0 && <div className="empty" style={{ padding: '14px 0', fontSize: '0.76rem' }}>Empty</div>}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {tab === 'quotes' && (
          <div className="card" style={{ padding: '8px 20px' }}>
            {canEdit && <button className="btn primary small" style={{ margin: '12px 0' }} onClick={() => setQuoteModal('new')}>+ Add quote</button>}
            {project.quotes.length === 0 ? (
              <div className="empty">No quotes yet.</div>
            ) : (
              <table className="tbl">
                <thead><tr><th>Vendor</th><th>Reference</th><th className="num">Amount</th><th>Status</th><th>Date</th><th>Notes</th></tr></thead>
                <tbody>
                  {project.quotes.map((q) => (
                    <tr key={q.id} className={canEdit ? 'clickable' : ''} onClick={() => canEdit && setQuoteModal(q)}>
                      <td><b>{q.vendor}</b></td>
                      <td className="muted">{q.reference || '—'}</td>
                      <td className="num"><b>{fmtMoney(q.amount)}</b></td>
                      <td><Badge value={q.status} /></td>
                      <td className="faint">{fmtDate(q.quote_date)}</td>
                      <td className="muted" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === 'documents' && (
          <div className="card" style={{ padding: '8px 20px' }}>
            {canEdit && (
              <div style={{ margin: '12px 0' }}>
                <input type="file" ref={fileRef} style={{ display: 'none' }} onChange={uploadFile} />
                <button className="btn primary small" onClick={() => fileRef.current.click()}>+ Upload document</button>
              </div>
            )}
            {project.documents.length === 0 ? (
              <div className="empty">No documents yet.</div>
            ) : (
              <table className="tbl">
                <thead><tr><th>File</th><th className="num">Size</th><th>Uploaded by</th><th>Date</th><th></th></tr></thead>
                <tbody>
                  {project.documents.map((d) => (
                    <tr key={d.id}>
                      <td><a href={`/api/documents/${d.id}/download`} onClick={(e) => { e.preventDefault(); downloadDoc(d); }}>{d.original_name}</a></td>
                      <td className="num faint">{(d.size / 1024).toFixed(0)} KB</td>
                      <td className="muted">{d.uploader_name || '—'}</td>
                      <td className="faint">{fmtDate(d.created_at)}</td>
                      <td className="num">{canEdit && <button className="btn small danger" onClick={() => deleteDoc(d.id)}>Delete</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
        {tab === 'compare' && <CompareChat projectId={project.id} onDocsChanged={load} />}

        {tab === 'details' && (
          <div className="card">
            <h2 style={{ fontSize: '0.95rem', marginBottom: 14 }}>Project intake details</h2>
            {(() => {
              let intake = null;
              try { intake = project.intake ? JSON.parse(project.intake) : null; } catch { /* older project */ }
              const rows = [
                ['Department', project.department],
                ['Expense type', project.expense_type],
                ...(intake ? Object.entries(intake).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v]) : []),
              ].filter(([, v]) => v && String(v).trim());
              if (!rows.length) return <div className="empty">No intake details recorded for this project.</div>;
              return (
                <table className="tbl">
                  <tbody>
                    {rows.map(([k, v]) => (
                      <tr key={k}>
                        <td className="muted" style={{ width: 280, verticalAlign: 'top' }}>{k}</td>
                        <td style={{ whiteSpace: 'pre-wrap' }}>{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })()}
          </div>
        )}
      </div>

      {taskModal && <TaskForm initial={taskModal === 'new' ? null : taskModal} users={users} onSave={saveTask} onClose={() => setTaskModal(null)} />}
      {quoteModal && <QuoteForm initial={quoteModal === 'new' ? null : quoteModal} onSave={saveQuote} onClose={() => setQuoteModal(null)} />}
      {editProject && <ProjectForm initial={project} users={users} onSave={saveProject} onClose={() => setEditProject(false)} />}
    </>
  );
}

// Fetch with the auth header, then trigger a browser download.
async function downloadDoc(doc) {
  const token = localStorage.getItem('portal_token');
  const res = await fetch(`/api/documents/${doc.id}/download`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return alert('Download failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = doc.original_name;
  a.click();
  URL.revokeObjectURL(url);
}
