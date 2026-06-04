import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';

export default function Login() {
  const { user, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  if (user) return <Navigate to={user.initial_setup_required ? '/setup' : '/'} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
      navigate('/');
    } catch {
      setError('Invalid credentials');
    } finally {
      setBusy(false);
    }
  };

  const year = new Date().getFullYear();

  return (
    <div className="auth-shell">
      <section className="auth-poster">
        <div className="topline">
          <span className="pip" /> Shakti / Operations Console
        </div>
        <div>
          <h1 className="wordmark">Shakti<span className="dot">.</span></h1>
          <p className="tagline">
            A quiet, deliberate place to move inventory, audit decisions, and trust the trail.
          </p>
        </div>
        <div className="colophon">
          <span>Vol. 02</span>
          <span>Section 01 — Foundations</span>
          <span>© {year} Innoviti</span>
        </div>
      </section>

      <section className="auth-form-wrap">
        <form className="auth-form" onSubmit={submit}>
          <p className="label-section">Sign in</p>
          <h2>Welcome back.</h2>
          <p className="lede">
            Use your work email and password.
          </p>

          <div className="field">
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@innoviti.com"
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          {error && <div className="error-text">{error}</div>}

          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="small-link">
            Lost your password? Ask an administrator for a reset URL.
          </p>
        </form>
      </section>
    </div>
  );
}
