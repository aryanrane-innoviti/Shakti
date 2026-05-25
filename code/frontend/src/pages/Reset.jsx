import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import GlobalLoader from '../components/GlobalLoader.jsx';

export default function Reset() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    if (!password || password !== confirm) {
      setErr('Passwords must match.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/auth/password-reset/consume', { token, new_password: password });
      setMsg('Password updated. Redirecting to sign in…');
      setTimeout(() => navigate('/login'), 1200);
    } catch (e) {
      setErr(e.data?.error || 'Reset failed');
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <div className="auth-shell">
        <section className="auth-poster">
          <div className="topline"><span className="pip" /> Password Reset</div>
          <div>
            <h1 className="wordmark">404<span className="dot">.</span></h1>
            <p className="tagline">No reset token in the URL.</p>
          </div>
          <div className="colophon"><span>Ask an admin for a new link.</span></div>
        </section>
        <section className="auth-form-wrap">
          <div className="auth-form">
            <p className="label-section">Invalid link</p>
            <h2>This URL is missing its token.</h2>
            <p className="lede">Reset URLs are single-use. If yours has been consumed or expired, ask your admin to issue a fresh one.</p>
            <button className="primary" onClick={() => navigate('/login')} style={{ width: '100%' }}>Back to sign in</button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <GlobalLoader />
      <section className="auth-poster">
        <div className="topline"><span className="pip" /> Password Reset</div>
        <div>
          <h1 className="wordmark">Shakti<span className="dot">.</span></h1>
          <p className="tagline">Set the password you'll use to sign in.</p>
        </div>
        <div className="colophon">
          <span>Single-use link</span>
          <span>Expires in 24h</span>
        </div>
      </section>

      <section className="auth-form-wrap">
        <form className="auth-form" onSubmit={submit}>
          <p className="label-section">New password</p>
          <h2>Set your password.</h2>
          <p className="lede">Pick something memorable. You'll use it together with your email.</p>

          <div className="field">
            <label>New password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="new-password" />
          </div>
          <div className="field">
            <label>Confirm</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </div>

          {err && <div className="error-text">{err}</div>}
          {msg && <div className="help-text" style={{ color: 'var(--success)' }}>{msg}</div>}

          <button type="submit" className="primary" disabled={busy}>{busy ? 'Setting…' : 'Set password'}</button>
        </form>
      </section>
    </div>
  );
}
