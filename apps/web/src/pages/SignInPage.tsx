import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import './AuthPage.css';

export function SignInPage() {
  const { login } = useAuth(); const navigate = useNavigate(); const location = useLocation();
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); setError(''); try { await login(String(data.get('identity')), String(data.get('password'))); navigate((location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/race', { replace: true }); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Sign-in failed.'); } finally { setBusy(false); } }
  return <section className="auth-page"><form className="auth-card" onSubmit={submit}><h1>Welcome back</h1><p>Sign in to save verified runs and join private races.</p>{error && <p className="form-error">{error}</p>}<label>Username or email<input name="identity" required autoComplete="username" /></label><label>Password<input name="password" type="password" required autoComplete="current-password" /></label><button className="btn btn-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button><p className="auth-switch">New here? <Link to="/register">Create an account</Link></p></form></section>;
}
