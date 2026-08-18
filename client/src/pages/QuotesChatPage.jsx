import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { ApprovalBadge } from '../App.jsx';
import CompareChat from './CompareChat.jsx';

// One Compare Quotes chat: the conversation on the left, the form panel on the
// right. Back returns to the chat history log. One imported form per chat —
// after import the panel locks to it.
export default function QuotesChatPage() {
  const { sid } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [forms, setForms] = useState([]);
  const [signal, setSignal] = useState(0);
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState('');

  const load = () =>
    api(`/quotes-sessions/${sid}`).then((d) => setSession(d.session)).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [sid]);
  useEffect(() => { api('/quotes-chat/forms').then(setForms).catch(() => {}); }, []);

  const importForm = async (p) => {
    setErr('');
    setBusyId(p.id);
    try {
      const res = await api(`/quotes-sessions/${sid}/import/${p.id}`, { method: 'POST' });
      setSession(res.session);
      setSignal((s) => s + 1);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const closeChat = async () => {
    await api(`/quotes-sessions/${sid}/close`, { method: 'POST' });
    navigate('/quotes');
  };

  if (err && !session) return <div className="form-err">{err}</div>;
  if (!session) return <div className="muted">Loading…</div>;

  const locked = !!session.project_id;

  return (
    <>
      <div className="dash-bg" />
      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button className="btn" onClick={() => navigate('/quotes')}>← Back</button>
          <div>
            <h1 style={{ color: 'var(--navy)', fontSize: '1.4rem' }}>{session.title}</h1>
            {session.status === 'closed' && <div className="page-sub">This chat is closed — read-only.</div>}
          </div>
        </div>
        {session.status === 'open' && (
          <button className="btn" onClick={closeChat}>Close chat</button>
        )}
      </div>

      <div className="quotes-grid">
        <CompareChat sessionId={sid} readOnly={session.status !== 'open'} refreshSignal={signal} />
        <div className="card">
          <h3 style={{ fontSize: '0.9rem', fontWeight: 800, marginBottom: 4 }}>Import form</h3>
          {locked ? (
            <div className="faint" style={{ fontSize: '0.8rem' }}>
              🔒 This chat is locked to <b>{session.title}</b>. Start a new chat to assess another form.
            </div>
          ) : (
            <>
              <div className="faint" style={{ fontSize: '0.76rem', marginBottom: 12 }}>
                Approved and completed project forms, by reference. One form per chat.
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
                      {session.status === 'open' && (
                        <button className="btn small primary" disabled={busyId !== null} onClick={() => importForm(p)}>
                          {busyId === p.id ? 'Importing…' : 'Import'}
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
