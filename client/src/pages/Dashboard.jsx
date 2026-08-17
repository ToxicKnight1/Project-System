import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getToken } from '../api.js';
import { TierBadge, fmtMoney, fmtDate } from '../App.jsx';

const TIERS = [
  ['critical', 'Critical'],
  ['urgent', 'Urgent'],
  ['important', 'Important'],
  ['routine', 'Routine'],
  ['desirable', 'Desirable'],
];

function OpsRow({ p, onChanged, action }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const update = async (body) => {
    setBusy(true);
    try {
      await api(`/projects/${p.id}/ops`, { method: 'PUT', body });
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ops-row">
      <div className="ops-name" onClick={() => navigate(`/projects/${p.id}`)}>
        <b>{p.name}</b>
        <div className="faint" style={{ fontSize: '0.74rem' }}>
          {[p.department, p.owner_name && `Raised by ${p.owner_name}`, `Submitted ${fmtDate(p.created_at)}`].filter(Boolean).join(' · ')}
        </div>
      </div>
      <div className="ops-controls">
        <select value={p.priority_tier || ''} disabled={busy} onChange={(e) => update({ priority_tier: e.target.value })}>
          <option value="">Priority…</option>
          {TIERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input type="date" value={p.due_date || ''} disabled={busy} onChange={(e) => update({ due_date: e.target.value || null })} title="Due date" />
        <span className="muted num" style={{ minWidth: 90, textAlign: 'right' }}>{fmtMoney(p.budget_total || p.budget)}</span>
        {action === 'approve' ? (
          <button className="btn small primary" disabled={busy} onClick={() => update({ approval_status: 'approved' })}>Approve</button>
        ) : (
          <button className="btn small" disabled={busy} onClick={() => update({ approval_status: 'completed' })}>Mark completed</button>
        )}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  const load = () => api('/dashboard').then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const downloadReport = async () => {
    const res = await fetch('/api/reports/monthly', { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) return alert('Could not generate the report');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `project-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (err) return <div className="form-err">{err}</div>;
  if (!data) return <div className="muted">Loading…</div>;

  return (
    <>
      <div className="dash-bg" />
      <div className="page-head">
        <div>
          <h1>Operations Dashboard</h1>
          <div className="page-sub">Approve incoming projects, set priorities and due dates</div>
        </div>
        <button className="btn" onClick={downloadReport}>⬇ Monthly report (all projects)</button>
      </div>

      <div className="grid cols-4" style={{ marginBottom: 24 }}>
        <div className="stat-tile">
          <div className="label">Awaiting approval</div>
          <div className="value">{data.awaiting.length}</div>
        </div>
        <div className="stat-tile">
          <div className="label">Approved & running</div>
          <div className="value">{data.approved.length}</div>
        </div>
        <div className="stat-tile">
          <div className="label">Completed</div>
          <div className="value">{data.completed_count}</div>
        </div>
        <div className="stat-tile">
          <div className="label">Approved budget total</div>
          <div className="value">{fmtMoney(data.approved.reduce((s, p) => s + (p.budget_total || p.budget || 0), 0))}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 22 }}>
        <h2 style={{ fontSize: '0.95rem', marginBottom: 4 }}>Awaiting approval</h2>
        <div className="faint" style={{ fontSize: '0.78rem', marginBottom: 12 }}>
          Set the priority tier and due date, then approve. The requester is notified automatically.
        </div>
        {data.awaiting.length === 0 ? (
          <div className="empty">Nothing waiting — all caught up.</div>
        ) : (
          data.awaiting.map((p) => <OpsRow key={p.id} p={p} onChanged={load} action="approve" />)
        )}
      </div>

      <div className="card">
        <h2 style={{ fontSize: '0.95rem', marginBottom: 4 }}>Approved projects</h2>
        <div className="faint" style={{ fontSize: '0.78rem', marginBottom: 12 }}>
          Manage priority tiers and due dates as work progresses; mark projects completed when delivered.
        </div>
        {data.approved.length === 0 ? (
          <div className="empty">No approved projects in flight.</div>
        ) : (
          data.approved.map((p) => <OpsRow key={p.id} p={p} onChanged={load} action="complete" />)
        )}
      </div>
    </>
  );
}
