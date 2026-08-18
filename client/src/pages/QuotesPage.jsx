import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth, ApprovalBadge } from '../App.jsx';
import CompareChat from './CompareChat.jsx';

// Standalone Compare Quotes page: the chat covers the left of the page; the
// right panel lists project forms (approved or completed only) to import by
// their reference.
export default function QuotesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const home = user.role === 'manager' ? '/dashboard' : '/projects';
  const [forms, setForms] = useState([]);
  const [signal, setSignal] = useState(0);
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState('');

  const loadForms = () => api('/quotes-chat/forms').then(setForms).catch(() => {});
  useEffect(() => { loadForms(); }, []);

  const importForm = async (p) => {
    setErr('');
    setBusyId(p.id);
    try {
      await api(`/quotes-chat/import/${p.id}`, { method: 'POST' });
      setSignal((s) => s + 1);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div className="dash-bg" />
      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button className="btn" onClick={() => navigate(home)}>← Back</button>
          <h1 style={{ color: 'var(--navy)', fontSize: '1.6rem' }}>✦ Compare Quotes</h1>
        </div>
        <div className="faint" style={{ fontSize: '0.78rem' }}>The conversation saves automatically — leave and resume any time.</div>
      </div>
      <div className="quotes-grid">
        <CompareChat refreshSignal={signal} onChanged={loadForms} />
        <div className="card">
          <h3 style={{ fontSize: '0.9rem', fontWeight: 800, marginBottom: 4 }}>Import form</h3>
          <div className="faint" style={{ fontSize: '0.76rem', marginBottom: 12 }}>
            Approved and completed project forms, by reference.
          </div>
          {err && <div className="form-err" style={{ marginBottom: 10 }}>{err}</div>}
          {forms.length === 0 ? (
            <div className="empty">No approved or completed projects yet.</div>
          ) : (
            forms.map((p) => (
              <div key={p.id} className="import-row">
                <div style={{ minWidth: 0 }}>
                  <b style={{ fontSize: '0.84rem' }}>{p.reference}</b>
                  <div className="faint" style={{ fontSize: '0.74rem' }}>
                    {p.name}{p.owner_name ? ` · ${p.owner_name}` : ''}{p.urs_document_id ? '' : ' · no URS'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                  <ApprovalBadge value={p.approval_status} />
                  <button className="btn small primary" disabled={busyId !== null} onClick={() => importForm(p)}>
                    {busyId === p.id ? 'Importing…' : 'Import'}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
