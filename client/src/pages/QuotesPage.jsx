import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { fmtDate } from '../App.jsx';

// The Compare Quotes chat history log: saved chats to resume, closed chats to
// review. Each chat is labelled by the form imported into it.
export default function QuotesPage() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api('/quotes-sessions').then(setSessions).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const newChat = async () => {
    setBusy(true);
    try {
      const s = await api('/quotes-sessions', { method: 'POST' });
      navigate(`/quotes/${s.id}`);
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };

  const remove = async (s) => {
    if (!confirm(`Delete "${s.title}" permanently? Its conversation and documents are removed.`)) return;
    await api(`/quotes-sessions/${s.id}`, { method: 'DELETE' });
    load();
  };

  if (err) return <div className="form-err">{err}</div>;
  if (!sessions) return <div className="muted">Loading…</div>;

  const open = sessions.filter((s) => s.status === 'open');
  const closed = sessions.filter((s) => s.status === 'closed');

  const Row = ({ s }) => (
    <div className="ops-row">
      <div className="ops-name" onClick={() => navigate(`/quotes/${s.id}`)}>
        <b>{s.title}</b>
        <div className="faint" style={{ fontSize: '0.74rem' }}>
          {[`${s.message_count} message${s.message_count === 1 ? '' : 's'}`,
            s.last_message_at ? `Last activity ${fmtDate(s.last_message_at)}` : `Started ${fmtDate(s.created_at)}`,
            s.created_by_name].filter(Boolean).join(' · ')}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
        <span className={`badge ${s.status === 'open' ? 'green' : 'gray'}`}>{s.status === 'open' ? 'Open' : 'Closed'}</span>
        <button className="btn small" onClick={() => navigate(`/quotes/${s.id}`)}>{s.status === 'open' ? 'Resume' : 'View'}</button>
        <button className="btn small danger" onClick={() => remove(s)}>✕</button>
      </div>
    </div>
  );

  return (
    <>
      <div className="dash-bg" />
      <div className="page-head">
        <div style={{ flex: 1 }}>
          <h1 style={{ color: 'var(--navy)', fontSize: '1.6rem' }}>✦ Compare Quotes</h1>
          <div className="page-sub">Chat history</div>
        </div>
        <button className="btn primary" disabled={busy} onClick={newChat}>+ New chat</button>
        <div style={{ flex: 1 }} />
      </div>

      <div className="proj-columns" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="card">
          <h2 className="proj-col-title">Saved chats</h2>
          {open.length === 0 ? (
            <div className="empty">No open chats — start a new one.</div>
          ) : (
            open.map((s) => <Row key={s.id} s={s} />)
          )}
        </div>
        <div className="card">
          <h2 className="proj-col-title">Closed chats</h2>
          {closed.length === 0 ? (
            <div className="empty">Nothing closed yet.</div>
          ) : (
            closed.map((s) => <Row key={s.id} s={s} />)
          )}
        </div>
      </div>
    </>
  );
}
