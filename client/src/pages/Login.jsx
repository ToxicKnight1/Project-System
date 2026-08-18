import React, { useState, useEffect } from 'react';
import { api, setToken } from '../api.js';
import { useAuth } from '../App.jsx';

const DEPARTMENTS = ['Engineering', 'Production', 'Warehouse', 'Regulatory Affairs', 'Finance', 'IT', 'Other'];

export default function Login() {
  const { setUser } = useAuth();
  const [mode, setMode] = useState('signin'); // 'signin' | 'create'
  const [role, setRole] = useState('operations'); // 'operations' | 'admin'
  const [form, setForm] = useState({ name: '', job_title: '', department: '', email: '', password: '' });
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  // As soon as a known company email is typed on Sign In, shift the
  // Operations/Admin pill to the side that account actually belongs to.
  useEffect(() => {
    if (mode !== 'signin' || !/^\S+@\S+\.\S+$/.test(form.email)) return undefined;
    const t = setTimeout(() => {
      api('/auth/lookup', { method: 'POST', body: { email: form.email } })
        .then((d) => {
          if (d.role === 'manager') setRole('operations');
          else if (d.role === 'admin') setRole('admin');
        })
        .catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [form.email, mode]);

  const switchMode = (m) => {
    setMode(m);
    setErr('');
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const res =
        mode === 'signin'
          ? await api('/auth/login', { method: 'POST', body: { email: form.email, password: form.password } })
          : await api('/auth/register', { method: 'POST', body: { ...form, role } });
      // Shift the role pill to the account's actual role so signing in as an
      // Admin visibly selects Admin (and Operations likewise) before entering.
      const actual = res.user.role === 'manager' ? 'operations' : res.user.role === 'admin' ? 'admin' : null;
      if (mode === 'signin' && actual && actual !== role) {
        setRole(actual);
        await new Promise((r) => setTimeout(r, 450));
      }
      setToken(res.token);
      setUser(res.user);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-tabs">
          <button type="button" className={`auth-tab${mode === 'signin' ? ' active' : ''}`} onClick={() => switchMode('signin')}>
            Sign In
          </button>
          <button type="button" className={`auth-tab${mode === 'create' ? ' active' : ''}`} onClick={() => switchMode('create')}>
            Create Account
          </button>
        </div>

        <div className="role-pills">
          <button type="button" className={`role-pill${role === 'operations' ? ' active' : ''}`} onClick={() => setRole('operations')}>
            <span className="dot" /> Operations
          </button>
          <button type="button" className={`role-pill${role === 'admin' ? ' active' : ''}`} onClick={() => setRole('admin')}>
            <span className="dot" /> Admin
          </button>
        </div>

        {err && <div className="auth-err">{err}</div>}

        {mode === 'create' && (
          <>
            <div className="auth-field">
              <label>Full Name</label>
              <input value={form.name} onChange={set('name')} placeholder="e.g. Sarah Mitchell" required autoFocus />
            </div>
            <div className="auth-field">
              <label>Job Title / Position</label>
              <input value={form.job_title} onChange={set('job_title')} placeholder="e.g. Project Engineer" />
            </div>
            <div className="auth-field">
              <label>Department</label>
              <select value={form.department} onChange={set('department')} required>
                <option value="">Select department…</option>
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          </>
        )}

        <div className="auth-field">
          <label>{mode === 'create' ? 'Work Email' : 'Company Email'}</label>
          <input type="email" value={form.email} onChange={set('email')} placeholder="you@centralpharma.com" required />
        </div>

        <div className="auth-field">
          <label>{mode === 'create' ? 'Create Your Password' : 'Password'}</label>
          <div className="pw-row">
            <input
              type={showPw ? 'text' : 'password'}
              value={form.password}
              onChange={set('password')}
              placeholder={mode === 'create' ? 'Choose a password (min 8 characters)' : 'Enter your password'}
              minLength={mode === 'create' ? 8 : undefined}
              required
            />
            <button type="button" className="pw-show" onClick={() => setShowPw(!showPw)}>
              {showPw ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>

        <button className="auth-submit" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign In' : 'Create Account →'}
        </button>
      </form>
      <div className="auth-hero">
        <div className="brand-row">
          <span className="brand-pill"><b>central</b>pharma</span>
          <span className="brand-title">Project Management</span>
        </div>
        <p className="hero-quote">
          "At Central Pharma we pride ourselves on operational excellence — above all in how we
          coordinate and manage our projects. Our approach is hands-on, transparent and resilient:
          every project planned with clarity, tracked with discipline, and delivered by a team
          working from one shared source of truth — accountable from the first quote to the final
          handover."
        </p>
      </div>
    </div>
  );
}
