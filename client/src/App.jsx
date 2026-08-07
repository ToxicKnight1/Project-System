import React, { createContext, useContext, useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import { api, getToken, clearToken } from './api.js';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Projects from './pages/Projects.jsx';
import ProjectDetail from './pages/ProjectDetail.jsx';
import Team from './pages/Team.jsx';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

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
    navigate('/login');
  };

  if (loading) return <div className="login-wrap muted">Loading…</div>;

  return (
    <AuthCtx.Provider value={{ user, setUser, logout }}>
      {!user ? (
        <Routes>
          <Route path="*" element={<Login />} />
        </Routes>
      ) : (
        <div className="layout">
          <nav className="sidebar">
            <div className="brand">Project <span>Portal</span></div>
            <NavLink to="/" end className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>Dashboard</NavLink>
            <NavLink to="/projects" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>Projects</NavLink>
            <NavLink to="/team" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>Team</NavLink>
            <div className="spacer" />
            <div className="whoami">
              <b>{user.name}</b>
              {user.role}
            </div>
            <button className="btn small" onClick={logout} style={{ margin: '10px 12px 0' }}>Sign out</button>
          </nav>
          <main className="main">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/projects/:id" element={<ProjectDetail />} />
              <Route path="/team" element={<Team />} />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </main>
        </div>
      )}
    </AuthCtx.Provider>
  );
}

// Shared helpers used across pages
export const STATUS_LABELS = {
  planning: ['Planning', 'blue'],
  active: ['Active', 'green'],
  on_hold: ['On hold', 'yellow'],
  completed: ['Completed', 'gray'],
  cancelled: ['Cancelled', 'red'],
  todo: ['To do', 'gray'],
  in_progress: ['In progress', 'blue'],
  done: ['Done', 'green'],
  pending: ['Pending', 'yellow'],
  accepted: ['Accepted', 'green'],
  rejected: ['Rejected', 'red'],
  low: ['Low', 'gray'],
  medium: ['Medium', 'blue'],
  high: ['High', 'red'],
};

export function Badge({ value }) {
  const [label, color] = STATUS_LABELS[value] || [value, 'gray'];
  return <span className={`badge ${color}`}>{label}</span>;
}

export const fmtMoney = (n) =>
  n == null ? '—' : Number(n).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export const fmtDate = (d) => (d ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString() : '—');
