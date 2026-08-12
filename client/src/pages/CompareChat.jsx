import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';

export default function CompareChat({ projectId, onDocsChanged }) {
  const { user } = useAuth();
  const canChat = user.role !== 'viewer';
  const [messages, setMessages] = useState(null); // null = loading
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('Analysing');
  const [err, setErr] = useState('');
  const bottomRef = useRef();
  const fileRef = useRef();
  const startedRef = useRef(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  // Load the shared conversation; open it with the assistant's questions if new.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api(`/projects/${projectId}/ai-chat`);
        if (cancelled) return;
        if (res.messages.length === 0 && canChat && !startedRef.current) {
          startedRef.current = true;
          setMessages([]);
          setBusy(true);
          setBusyLabel('Preparing the conversation');
          const started = await api(`/projects/${projectId}/ai-chat/start`, { method: 'POST' });
          if (!cancelled) setMessages(started.messages);
        } else {
          setMessages(res.messages);
        }
      } catch (e) {
        if (!cancelled) { setErr(e.message); setMessages([]); }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  const run = async (label, fn) => {
    if (busy) return;
    setErr('');
    setBusy(true);
    setBusyLabel(label);
    try {
      const res = await fn();
      setMessages(res.messages);
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
    setMessages((m) => [...m, { id: `tmp-${Date.now()}`, role: 'user', kind: 'chat', content: q, user_name: user.name }]);
    run('Analysing', () => api(`/projects/${projectId}/ai-chat`, { method: 'POST', body: { message: q } }));
  };

  const breakdown = () =>
    run('Generating the full breakdown — this takes a little longer', () =>
      api(`/projects/${projectId}/ai-chat/breakdown`, { method: 'POST' }));

  const attach = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length || busy) return;
    setErr('');
    setBusy(true);
    setBusyLabel('Uploading and reading the quotes');
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append('file', file);
        await api(`/projects/${projectId}/documents`, { method: 'POST', formData: fd });
      }
      onDocsChanged?.();
      const names = files.map((f) => `"${f.name}"`).join(', ');
      const res = await api(`/projects/${projectId}/ai-chat`, {
        method: 'POST',
        body: { message: `I have just attached ${names}. Please confirm what you can read from ${files.length > 1 ? 'them' : 'it'} in a couple of lines.` },
      });
      setMessages(res.messages);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!confirm('Clear this conversation for everyone on the project? Documents and quotes are kept.')) return;
    await api(`/projects/${projectId}/ai-chat`, { method: 'DELETE' });
    startedRef.current = false;
    setMessages([]);
    run('Preparing the conversation', () => api(`/projects/${projectId}/ai-chat/start`, { method: 'POST' }));
  };

  if (messages === null) return <div className="muted">Loading conversation…</div>;

  return (
    <div className="compare-wrap">
      <div className="chat-box card">
        <div className="chat-toolbar">
          <div className="faint">
            Shared project conversation — attach supplier quotes with the paperclip, answer the assistant's questions,
            then generate the full breakdown when you're ready to decide.
          </div>
          {canChat && (
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button className="btn small primary" onClick={breakdown} disabled={busy}>Generate breakdown</button>
              <button className="btn small" onClick={reset} disabled={busy}>Reset</button>
            </div>
          )}
        </div>

        <div className="chat-scroll">
          {messages.map((m) => (
            <div key={m.id} className={`chat-msg ${m.role}`}>
              <div className={`chat-bubble${m.kind === 'breakdown' ? ' breakdown' : ''}`}>
                {m.role === 'user' && m.user_name && <div className="chat-name">{m.user_name}</div>}
                {m.kind === 'breakdown' && <div className="chat-breakdown-title">📋 Supplier Comparison Breakdown</div>}
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

        {canChat ? (
          <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <input type="file" ref={fileRef} multiple style={{ display: 'none' }}
              accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.md,.json" onChange={attach} />
            <button type="button" className="btn attach" title="Attach supplier quotes"
              onClick={() => fileRef.current.click()} disabled={busy}>📎</button>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Answer the questions, or ask about the quotes…"
              disabled={busy}
            />
            <button className="btn primary" disabled={busy || !input.trim()}>Send</button>
          </form>
        ) : (
          <div className="faint" style={{ marginTop: 12 }}>You have read-only access to this conversation.</div>
        )}
      </div>
    </div>
  );
}
