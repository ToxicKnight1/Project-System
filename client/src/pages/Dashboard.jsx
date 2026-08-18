import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getToken } from '../api.js';
import { fmtMoney, fmtDate, MonthNav } from '../App.jsx';

// Read-only row: approving and status changes happen inside the form itself.
function OpsRow({ p }) {
  const navigate = useNavigate();
  return (
    <div className="ops-row column">
      <div className="ops-name" onClick={() => navigate(`/projects/${p.id}`)}>
        <div style={{ minWidth: 0 }}>
          <b>{p.name}</b>
          <div className="faint" style={{ fontSize: '0.74rem' }}>
            {[p.reference, p.owner_name && `Raised by ${p.owner_name}${p.owner_department ? ` · ${p.owner_department}` : ''}`, `Submitted ${fmtDate(p.created_at)}`].filter(Boolean).join(' · ')}
          </div>
          <div style={{ fontSize: '0.78rem', marginTop: 4, color: 'var(--accent)', fontWeight: 600 }}>
            {[fmtMoney(p.budget_total || p.budget), p.due_date && `Due ${fmtDate(p.due_date)}`].filter(Boolean).join(' · ')}
          </div>
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
  const awaiting = data.awaiting.filter(inMonth);
  const approved = data.approved.filter(inMonth);
  const completed = (data.completed || []).filter(inMonth);

  const Column = ({ label, count, items, empty, help }) => (
    <div className="card dash-col">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div className="label">
          {label}{help && <> <span className="help-q" title={help}>?</span></>}
        </div>
        <div className="value" style={{ fontSize: '1.35rem' }}>{count}</div>
      </div>
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
          <div className="page-sub">{awaiting.length + approved.length + completed.length} total</div>
        </div>
        <MonthNav value={month} onChange={setMonth} />
        <div style={{ flex: 1 }} />
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
        <div>
          <div className="stat-tile budget" style={{ marginBottom: 6 }}>
            <div className="label" style={{ color: '#b91c1c' }}>Completed project expenditure</div>
            <div className="value">{fmtMoney(completed.reduce((s, p) => s + (p.budget_total || p.budget || 0), 0))}</div>
          </div>
          <div className="stat-tile budget">
            <div className="label" style={{ color: 'var(--accent)' }}>Approved budget total</div>
            <div className="value">{fmtMoney(approved.reduce((s, p) => s + (p.budget_total || p.budget || 0), 0))}</div>
          </div>
        </div>
      </div>

      <div className="report-corner">
        <button className="btn" onClick={downloadReport}>Monthly report ⬇</button>
      </div>
    </>
  );
}
