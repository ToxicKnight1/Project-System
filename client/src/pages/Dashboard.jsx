import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getToken } from '../api.js';
import { fmtMoney, fmtDate } from '../App.jsx';

// Read-only row: approving and status changes happen inside the form itself.
function OpsRow({ p }) {
  const navigate = useNavigate();
  return (
    <div className="ops-row column">
      <div className="ops-name" onClick={() => navigate(`/projects/${p.id}`)}>
        <b>{p.name}</b>
        <div className="faint" style={{ fontSize: '0.74rem' }}>
          {[p.reference, p.owner_name && `Raised by ${p.owner_name}${p.owner_department ? ` · ${p.owner_department}` : ''}`, `Submitted ${fmtDate(p.created_at)}`].filter(Boolean).join(' · ')}
        </div>
        <div className="muted" style={{ fontSize: '0.78rem', marginTop: 4 }}>
          {[fmtMoney(p.budget_total || p.budget), p.due_date && `Due ${fmtDate(p.due_date)}`].filter(Boolean).join(' · ')}
        </div>
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
    a.download = `monthly-report-${new Date().toISOString().slice(0, 10)}.pdf`;
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
        </div>
      </div>

      <div className="dash-tiles" style={{ marginBottom: 24 }}>
        <div className="stat-tile">
          <div className="label">
            Awaiting approval{' '}
            <span className="help-q" title="Projects submitted by requesters that need an Operations decision. Open one to review the form and approve it there.">?</span>
          </div>
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
        <div className="stat-tile budget">
          <div className="label">Approved budget total</div>
          <div className="value">{fmtMoney(data.approved.reduce((s, p) => s + (p.budget_total || p.budget || 0), 0))}</div>
        </div>
      </div>

      <div className="dash-columns">
        <div className="card">
          <h2 style={{ fontSize: '0.95rem', marginBottom: 12 }}>Awaiting approval</h2>
          {data.awaiting.length === 0 ? (
            <div className="empty">Nothing waiting — all caught up.</div>
          ) : (
            data.awaiting.map((p) => <OpsRow key={p.id} p={p} />)
          )}
        </div>

        <div className="card">
          <h2 style={{ fontSize: '0.95rem', marginBottom: 12 }}>Approved & running</h2>
          {data.approved.length === 0 ? (
            <div className="empty">No approved projects in flight.</div>
          ) : (
            data.approved.map((p) => <OpsRow key={p.id} p={p} />)
          )}
        </div>

        <div className="card">
          <h2 style={{ fontSize: '0.95rem', marginBottom: 12 }}>Completed</h2>
          {(data.completed || []).length === 0 ? (
            <div className="empty">Nothing completed yet.</div>
          ) : (
            data.completed.map((p) => <OpsRow key={p.id} p={p} />)
          )}
        </div>
      </div>

      <div className="report-corner">
        <button className="btn" onClick={downloadReport}>Monthly report ⬇</button>
      </div>
    </>
  );
}
