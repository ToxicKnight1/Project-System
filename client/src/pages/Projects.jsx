import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth, ApprovalBadge, TierBadge, fmtMoney, fmtDate, MonthNav } from '../App.jsx';
import IntakeWizard from './IntakeWizard.jsx';

function ProjectRow({ p, onOpen, onResume }) {
  const isDraft = p.approval_status === 'draft';
  return (
    <div className="proj-row" onClick={() => (isDraft ? onResume(p) : onOpen(p))}>
      <div className="proj-main">
        <b>{p.name}</b>
        <div className="faint" style={{ fontSize: '0.76rem' }}>
          {[p.reference, p.department, p.owner_name && `Raised by ${p.owner_name}${p.owner_department ? ` · ${p.owner_department}` : ''}`].filter(Boolean).join(' · ')}
        </div>
      </div>
      <div className="proj-meta">
        {isDraft ? <span className="badge gray">Draft</span> : <ApprovalBadge value={p.approval_status} />}
        <TierBadge value={p.priority_tier} />
        <span className="muted num">{fmtMoney(p.budget_total || p.budget)}</span>
        <span className="faint">{p.due_date ? `Due ${fmtDate(p.due_date)}` : ''}</span>
        {isDraft && <button className="btn small primary" onClick={(e) => { e.stopPropagation(); onResume(p); }}>Resume</button>}
      </div>
    </div>
  );
}

export default function Projects() {
  const { user } = useAuth();
  const [projects, setProjects] = useState(null);
  const [wizard, setWizard] = useState(null); // null | 'new' | project (resume/edit)
  const [err, setErr] = useState('');
  const navigate = useNavigate();
  const canCreate = user.role !== 'viewer';

  const load = () => api('/projects').then(setProjects).catch((e) => setErr(e.message));
  // Wrapped so the effect returns undefined — returning load's Promise would make
  // React call it as a cleanup function on unmount and crash the page.
  useEffect(() => { load(); }, []);

  // After submitting (or drafting), return to the Projects list so the user can
  // see the project sitting in Active, open it freely, or raise another.
  const done = () => {
    setWizard(null);
    load();
  };

  const resume = async (p) => {
    const full = await api(`/projects/${p.id}`).catch(() => p);
    setWizard(full);
  };

  if (err) return <div className="form-err">{err}</div>;
  if (!projects) return <div className="muted">Loading…</div>;

  const active = projects.filter((p) => p.approval_status === 'draft' || p.approval_status === 'awaiting_approval');
  const approved = projects.filter((p) => p.approval_status === 'approved');
  const completed = projects.filter((p) => p.approval_status === 'completed');
  const openRow = (x) => navigate(`/projects/${x.id}`);

  return (
    <>
      <div className="dash-bg" />
      <div className="page-head">
        <div style={{ flex: 1 }}>
          <h1>Projects</h1>
          <div className="page-sub">{projects.length} total</div>
        </div>
        <MonthNav />
        <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
          {canCreate && <button className="btn primary" onClick={() => setWizard('new')}>+ New project</button>}
        </div>
      </div>

      <div className="proj-columns">
        <div className="proj-col card">
          <h2 className="proj-col-title">Awaiting approval</h2>
          {active.length === 0 ? (
            <div className="empty">Nothing awaiting approval.</div>
          ) : (
            active.map((p) => <ProjectRow key={p.id} p={p} onOpen={openRow} onResume={resume} />)
          )}
        </div>

        <div className="proj-col card">
          <h2 className="proj-col-title">Approved & running</h2>
          {approved.length === 0 ? (
            <div className="empty">Nothing approved yet.</div>
          ) : (
            approved.map((p) => <ProjectRow key={p.id} p={p} onOpen={openRow} onResume={() => {}} />)
          )}
        </div>

        <div className="proj-col card completed">
          <h2 className="proj-col-title">Completed</h2>
          {completed.length === 0 ? (
            <div className="empty">Nothing completed yet.</div>
          ) : (
            completed.map((p) => <ProjectRow key={p.id} p={p} onOpen={openRow} onResume={() => {}} />)
          )}
        </div>
      </div>

      {wizard && (
        <IntakeWizard
          existing={wizard === 'new' ? null : wizard}
          onDone={done}
          onClose={() => setWizard(null)}
        />
      )}
    </>
  );
}
