import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { ApprovalBadge } from '../App.jsx';
import CompareChat from './CompareChat.jsx';

// Compare Quotes lives on its own page: the chat interaction happens here,
// separate from the project form.
export default function QuotesPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [err, setErr] = useState('');

  const load = () => api(`/projects/${id}`).then(setProject).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [id]);

  if (err) return <div className="form-err">{err}</div>;
  if (!project) return <div className="muted">Loading…</div>;

  return (
    <>
      <div className="dash-bg" />
      <div className="page-head">
        <div>
          <div className="faint" style={{ fontSize: '0.76rem', marginBottom: 4 }}>
            <a onClick={() => navigate(`/projects/${id}`)} style={{ cursor: 'pointer' }}>← Back</a> / {project.reference} · {project.name} / Compare Quotes
          </div>
          <h1>✦ Compare Quotes</h1>
          <div className="page-sub">{project.reference} · {project.name}</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <ApprovalBadge value={project.approval_status} />
          <button className="btn" onClick={() => navigate(`/projects/${id}`)}>← Back</button>
        </div>
      </div>
      <CompareChat
        projectId={project.id}
        docCount={project.documents.length}
        hasUrs={!!project.urs_document_id}
        onDocsChanged={load}
      />
    </>
  );
}
