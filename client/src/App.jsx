import React, { createContext, useContext, useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { api, getToken, clearToken } from './api.js';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Projects from './pages/Projects.jsx';
import ProjectDetail from './pages/ProjectDetail.jsx';
import QuotesPage from './pages/QuotesPage.jsx';
import Team from './pages/Team.jsx';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

function NotificationBell() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const unread = items.filter((n) => !n.read).length;

  const load = () => api('/notifications').then(setItems).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  const toggle = async () => {
    const opening = !open;
    setOpen(opening);
    if (opening && unread > 0) {
      await api('/notifications/read', { method: 'POST' }).catch(() => {});
      setItems((list) => list.map((n) => ({ ...n, read: 1 })));
    }
  };

  return (
    <div className="bell-wrap">
      <button className="btn small bell" onClick={toggle} title="Notifications">
        🔔{unread > 0 && <span className="bell-badge">{unread}</span>}
      </button>
      {open && (
        <div className="bell-panel card">
          <b style={{ fontSize: '0.85rem' }}>Notifications</b>
          {items.length === 0 ? (
            <div className="faint" style={{ padding: '10px 0' }}>Nothing yet.</div>
          ) : (
            items.map((n) => (
              <div key={n.id} className="bell-item">
                {n.content}
                <div className="faint" style={{ fontSize: '0.68rem', marginTop: 2 }}>{fmtDate(n.created_at)}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api('/auth/me')
      .then(setUser)
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  const logout = () => {
    clearToken();
    setUser(null);
    navigate('/');
  };

  if (loading) return <div className="login-wrap muted">Loading…</div>;

  const isOps = user?.role === 'manager';
  const home = isOps ? '/dashboard' : '/projects';

  return (
    <AuthCtx.Provider value={{ user, setUser, logout }}>
      {!user ? (
        <Routes>
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Login />} />
        </Routes>
      ) : (
        <div className="layout">
          <nav className="topbar">
            <div className="brand">Project <span>Portal</span></div>
            <span className="topbar-logo"><b>central</b>pharma</span>
            <div className="topbar-links">
              <NavLink to={home} end className="nav-link">⌂ Home</NavLink>
              {isOps && <NavLink to="/projects" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>Projects</NavLink>}
              {isOps && <NavLink to="/quotes" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>✦ Compare Quotes</NavLink>}
            </div>
            <div className="topbar-user">
              <NotificationBell />
              <span className="whoami"><b>{user.name}</b> · {ROLE_LABELS[user.role] || user.role}</span>
              <button className="btn small" onClick={logout}>Sign out</button>
            </div>
          </nav>
          <main className="main">
            <Routes>
              <Route path="/" element={<Navigate to={home} replace />} />
              <Route path="/dashboard" element={isOps ? <Dashboard /> : <Navigate to="/projects" replace />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/projects/:id" element={<ProjectDetail />} />
              <Route path="/quotes" element={isOps ? <QuotesPage /> : <Navigate to="/projects" replace />} />
              <Route path="/team" element={<Team />} />
              <Route path="*" element={<Navigate to={home} />} />
            </Routes>
          </main>
        </div>
      )}
    </AuthCtx.Provider>
  );
}

// Shared helpers used across pages
export const ROLE_LABELS = { admin: 'Admin', manager: 'Operations', viewer: 'Viewer' };

export const APPROVAL_LABELS = {
  draft: ['Draft', 'gray'],
  awaiting_approval: ['Awaiting approval', 'yellow'],
  approved: ['Approved', 'green'],
  completed: ['Completed', 'gray'],
};

export const TIER_LABELS = {
  critical: ['Critical', 'red'],
  urgent: ['Urgent', 'red'],
  important: ['Important', 'yellow'],
  routine: ['Routine', 'blue'],
  desirable: ['Desirable', 'gray'],
};

export function ApprovalBadge({ value }) {
  const [label, color] = APPROVAL_LABELS[value] || [value, 'gray'];
  return <span className={`badge ${color}`}>{label}</span>;
}

export function TierBadge({ value }) {
  if (!value) return null;
  const [label, color] = TIER_LABELS[value] || [value, 'gray'];
  return <span className={`badge ${color}`}>{label}</span>;
}

export const fmtMoney = (n) =>
  n == null ? '—' : Number(n).toLocaleString('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });

export const fmtDate = (d) => (d ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString() : '—');
