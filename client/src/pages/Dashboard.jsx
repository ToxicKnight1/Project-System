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
  const now = new Date();
  const [month, setMonth] = useState({ y: now.getFullYear(), m: now.getMonth() });

  const load = () => api('/dashboard').then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const monthKey = `${month.y}-${String(month.m + 1).padStart(2, '0')}`;
  const shiftMonth = (d) => {
    const date = new Date(month.y, month.m + d, 1);
    setMonth({ y: date.getFullYear(), m: date.getMonth() });
  };

  const downloadReport = async () => {
    const res = await fetch(`/api/reports/monthly?month=${monthKey}`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) return alert('Could not generate the report');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `monthly-report-${monthKey}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (err) return <div className="form-err">{err}</div>;
  if (!data) return <div className="muted">Loading…</div>;

  const inMonth = (p) => String(p.created_at || '').slice(0, 7) === monthKey;
  const monthName = new Date(month.y, month.m, 1).toLocaleDateString('en-GB', { month: 'long' });
  const awaiting = data.awaiting.filter(inMonth);
  const approved = data.approved.filter(inMonth);
  const completed = (data.completed || []).filter(inMonth);

  const Column = ({ label, count, items, empty, help }) => (
    <div className="card dash-col">
      <div className="label">
        {label}{help && <> <span className="help-q" title={help}>?</span></>}
      </div>
      <div className="value">{count}</div>
      <div className="red-rule" />
      {items.length === 0 ? (
        <div className="empty">{empty}</div>
      ) : (
        items.map((p) => <OpsRow key={p.id} p={p} />)
      )}
    </div>
  );

  return (
    <>
      <div className="dash-bg" />
      <div className="page-head">
        <div style={{ flex: 1 }}>
          <h1>Operations Dashboard</h1>
        </div>
        <div className="month-nav">
          <button className="btn small" onClick={() => shiftMonth(-1)} title="Previous month">←</button>
          <span className="month-pill">{monthName}</span>
          <button className="btn small" onClick={() => shiftMonth(1)} title="Next month">→</button>
        </div>
        <div className="year-corner">{month.y}</div>
      </div>

      <div className="dash-columns">
        <Column
          label="Awaiting approval"
          help="Projects submitted by requesters that need an Operations decision. Open one to review the form and approve it there."
          count={awaiting.length}
          items={awaiting}
          empty="Nothing waiting — all caught up."
        />
        <Column label="Approved & running" count={approved.length} items={approved} empty="No approved projects in flight." />
        <Column label="Completed" count={completed.length} items={completed} empty="Nothing completed yet." />
        <div className="stat-tile budget">
          <div className="label">Approved budget total</div>
          <div className="value">{fmtMoney(approved.reduce((s, p) => s + (p.budget_total || p.budget || 0), 0))}</div>
        </div>
      </div>

      <div className="report-corner">
        <button className="btn" onClick={downloadReport}>Monthly report ⬇</button>
      </div>
    </>
  );
}
