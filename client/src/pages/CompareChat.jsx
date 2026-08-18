import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';

// The standalone Compare Quotes chat. Documents and history are shared by
// Operations; project forms are imported from the panel beside the chat.
export default function CompareChat({ sessionId, readOnly = false, refreshSignal = 0, onChanged }) {
  const { user } = useAuth();
  const canChat = user.role === 'manager' && !readOnly;
  const [messages, setMessages] = useState(null); // null = loading
  const [docCount, setDocCount] = useState(0);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('Analysing');
  const [err, setErr] = useState('');
  const bottomRef = useRef();
  const fileRef = useRef();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  useEffect(() => {
    let cancelled = false;
    api(`/quotes-sessions/${sessionId}`)
      .then((res) => { if (!cancelled) { setMessages(res.messages); setDocCount(res.doc_count); } })
      .catch((e) => { if (!cancelled) { setErr(e.message); setMessages([]); } });
    return () => { cancelled = true; };
  }, [sessionId, refreshSignal]);

  const run = async (label, fn) => {
    if (busy) return;
    setErr('');
    setBusy(true);
    setBusyLabel(label);
    try {
      const res = await fn();
      setMessages(res.messages);
      if (res.doc_count !== undefined) setDocCount(res.doc_count);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const send = () => {
    const q = input.trim();
    if (!q) return;
    setInput('');
    setMessages((m) => [...m, { id: `tmp-${Date.now()}`, role: 'user', content: q, user_name: user.name }]);
    run('Analysing', () => api(`/quotes-sessions/${sessionId}/message`, { method: 'POST', body: { message: q } }));
  };

  const attach = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length || busy) return;
    setErr('');
    setBusy(true);
    setBusyLabel('Uploading and reading the quotes');
    try {
      const fd = new FormData();
      for (const file of files) fd.append('files', file);
      await api(`/quotes-sessions/${sessionId}/documents`, { method: 'POST', formData: fd });
      const names = files.map((f) => `"${f.name}"`).join(', ');
      const res = await api(`/quotes-sessions/${sessionId}/message`, {
        method: 'POST',
        body: { message: `I have just attached ${names}. Please confirm what you can read from ${files.length > 1 ? 'them' : 'it'} in a couple of lines.` },
      });
      setMessages(res.messages);
      setDocCount((n) => n + files.length);
      onChanged?.();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  if (messages === null) return <div className="muted">Loading conversation…</div>;

  const nothingToAnalyse = docCount === 0;

  return (
    <div className="chat-box card">
      <div className="chat-toolbar">
        <div className="faint">
          Quote assessment against three points: <b>URS fit</b>, <b>price</b>, <b>timeline</b>. Attach supplier quotes
          with the paperclip and import a project form for reference.
        </div>
      </div>

      <div className="chat-scroll">
        {messages.length === 0 && !busy && (
          <div className="empty" style={{ padding: '40px 20px' }}>
            {nothingToAnalyse
              ? 'The conversation starts once documentation is provided — attach the supplier quotes with the 📎 paperclip, or import a project form from the panel.'
              : 'Documents are attached. Import a project form or ask a question to begin the assessment.'}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg ${m.role}`}>
            <div className="chat-bubble">
              {m.role === 'user' && m.user_name && <div className="chat-name">{m.user_name}</div>}
              {m.content}
            </div>
          </div>
        ))}
        {busy && (
          <div className="chat-msg assistant">
            <div className="chat-bubble thinking">{busyLabel}<span className="dots">…</span></div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {err && <div className="form-err" style={{ margin: '10px 0 0' }}>{err}</div>}

      {canChat && (
        <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <input type="file" ref={fileRef} multiple style={{ display: 'none' }}
            accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.md,.json,.docx" onChange={attach} />
          <button type="button" className="btn attach" title="Attach supplier quotes"
            onClick={() => fileRef.current.click()} disabled={busy}>📎</button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={nothingToAnalyse ? 'Attach quote documents to begin…' : 'Ask about URS fit, price, or timeline…'}
            disabled={busy}
          />
          <button className="btn primary" disabled={busy || !input.trim()}>Send</button>
        </form>
      )}
    </div>
  );
}
