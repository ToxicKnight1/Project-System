import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Badge, fmtDate, fmtMoney } from '../App.jsx';

const count = (rows, status) => rows.find((r) => r.status === status)?.n || 0;

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api('/dashboard').then(setData).catch((e) => setErr(e.message));
  }, []);

  if (err) return <div className="form-err">{err}</div>;
  if (!data) return <div className="muted">Loading…</div>;

  const activeProjects = count(data.projectsByStatus, 'active');
  const planningProjects = count(data.projectsByStatus, 'planning');
  const openTaskCount = count(data.tasksByStatus, 'todo') + count(data.tasksByStatus, 'in_progress');
  const doneTaskCount = count(data.tasksByStatus, 'done');
  const pendingQuotes = data.quoteTotals.find((q) => q.status === 'pending');
  const acceptedQuotes = data.quoteTotals.find((q) => q.status === 'accepted');

  return (
    <>
      <div className="dash-bg" />
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <div className="page-sub">Overview of all projects, tasks and quotes</div>
        </div>
      </div>

      <div className="grid cols-4" style={{ marginBottom: 24 }}>
        <div className="stat-tile">
          <div className="label">Active projects</div>
          <div className="value">{activeProjects}</div>
          <div className="sub">{planningProjects} in planning</div>
        </div>
        <div className="stat-tile">
          <div className="label">Open tasks</div>
          <div className="value">{openTaskCount}</div>
          <div className="sub">{doneTaskCount} completed</div>
        </div>
        <div className="stat-tile">
          <div className="label">Pending quotes</div>
          <div className="value">{pendingQuotes?.n || 0}</div>
          <div className="sub">{fmtMoney(pendingQuotes?.total || 0)} awaiting decision</div>
        </div>
        <div className="stat-tile">
          <div className="label">Accepted quote value</div>
          <div className="value">{fmtMoney(acceptedQuotes?.total || 0)}</div>
          <div className="sub">{acceptedQuotes?.n || 0} accepted</div>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h2 style={{ fontSize: '0.95rem', marginBottom: 14 }}>Current projects</h2>
          {data.recentProjects.length === 0 ? (
            <div className="empty">No projects yet — create one from the Projects page.</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr><th>Project</th><th>Status</th><th>Progress</th><th>Due</th></tr>
              </thead>
              <tbody>
                {data.recentProjects.map((p) => {
                  const pct = p.task_count ? Math.round((p.done_count / p.task_count) * 100) : 0;
                  return (
                    <tr key={p.id} className="clickable" onClick={() => navigate(`/projects/${p.id}`)}>
                      <td><b>{p.name}</b><div className="faint" style={{ fontSize: '0.74rem' }}>{p.client}</div></td>
                      <td><Badge value={p.status} /></td>
                      <td style={{ minWidth: 110 }}>
                        <div className="progress-track"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
                        <div className="faint" style={{ fontSize: '0.7rem', marginTop: 3 }}>{p.done_count}/{p.task_count} tasks</div>
                      </td>
                      <td className="faint">{fmtDate(p.due_date)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h2 style={{ fontSize: '0.95rem', marginBottom: 14 }}>Upcoming open tasks</h2>
          {data.openTasks.length === 0 ? (
            <div className="empty">Nothing open. Enjoy the quiet.</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr><th>Task</th><th>Project</th><th>Assignee</th><th>Due</th></tr>
              </thead>
              <tbody>
                {data.openTasks.map((t) => (
                  <tr key={t.id} className="clickable" onClick={() => navigate(`/projects/${t.project_id}`)}>
                    <td><b>{t.title}</b> <Badge value={t.priority} /></td>
                    <td className="muted">{t.project_name}</td>
                    <td className="muted">{t.assignee_name || '—'}</td>
                    <td className="faint">{fmtDate(t.due_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
