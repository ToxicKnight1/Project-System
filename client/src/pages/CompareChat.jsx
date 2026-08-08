import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const STARTERS = [
  'Compare all the quotes like-for-like',
  'List the pros and cons of each supplier',
  'Which supplier offers the best overall value, and why?',
  'What is missing or inconsistent between the quotes?',
];

export default function CompareChat({ projectId, docCount }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const bottomRef = useRef();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  const send = async (text) => {
    const q = (text || input).trim();
    if (!q || busy) return;
    setErr('');
    setInput('');
    const nextMessages = [...messages, { role: 'user', content: q }];
    setMessages(nextMessages);
    setBusy(true);
    try {
      const res = await api(`/projects/${projectId}/ai-compare`, { method: 'POST', body: { messages: nextMessages } });
      setMessages([...nextMessages, { role: 'assistant', content: res.reply }]);
    } catch (e) {
      setErr(e.message);
      setMessages(messages); // roll back the unanswered question so it can be retried
      setInput(q);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="compare-wrap">
      <div className="compare-intro card">
        <b>Quote Comparison Assistant</b>
        <p>
          Upload the supplier quotes on the <b>Documents</b> tab (PDFs, images, or text files), then ask for a
          comparison here. The assistant reads every document plus the quotes logged on the Quotes tab, checks that
          you are comparing like-for-like, and lays out the pros and cons of each supplier — price, scope, speed of
          installation, exclusions, reliability — so the final judgment stays with you.
          {docCount === 0 && <span className="compare-warn"> No documents are uploaded yet — the assistant can only see quotes logged on the Quotes tab.</span>}
        </p>
      </div>

      <div className="chat-box card">
        <div className="chat-scroll">
          {messages.length === 0 && (
            <div className="chat-starters">
              <div className="faint" style={{ marginBottom: 10 }}>Try one of these to get started:</div>
              {STARTERS.map((s) => (
                <button key={s} className="btn small" onClick={() => send(s)} disabled={busy}>{s}</button>
              ))}
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`chat-msg ${m.role}`}>
              <div className="chat-bubble">{m.content}</div>
            </div>
          ))}
          {busy && (
            <div className="chat-msg assistant">
              <div className="chat-bubble thinking">Analysing the quotes<span className="dots">…</span></div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
        {err && <div className="form-err" style={{ margin: '10px 0 0' }}>{err}</div>}
        <form
          className="chat-input"
          onSubmit={(e) => { e.preventDefault(); send(); }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about the quotes — costs, scope differences, risks, recommendations…"
            disabled={busy}
          />
          <button className="btn primary" disabled={busy || !input.trim()}>Send</button>
        </form>
      </div>
    </div>
  );
}
