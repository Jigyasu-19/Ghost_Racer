import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import './AuthPage.css';
export function RegisterPage() {
  const { register } = useAuth(); const navigate = useNavigate(); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); setError(''); try { await register(String(data.get('username')), String(data.get('email')), String(data.get('password'))); navigate('/race', { replace: true }); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Registration failed.'); } finally { setBusy(false); } }
  return <section className="auth-page"><form className="auth-card" onSubmit={submit}><h1>Create your account</h1><p>Your verified best runs and tournament access live here.</p>{error && <p className="form-error">{error}</p>}<label>Username<input name="username" required minLength={3} maxLength={24} autoComplete="username" /></label><label>Email<input name="email" type="email" required autoComplete="email" /></label><label>Password<input name="password" type="password" required minLength={8} autoComplete="new-password" /></label><button className="btn btn-primary" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button><p className="auth-switch">Already registered? <Link to="/sign-in">Sign in</Link></p></form></section>;
}
