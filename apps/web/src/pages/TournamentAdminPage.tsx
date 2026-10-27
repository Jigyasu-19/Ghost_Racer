import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { CARS, TRACKS } from '@ghost-racer/content';
import { CreatedTournamentSchema, type CreatedTournament, type TournamentAdminHistory } from '@ghost-racer/contracts';
import { useAuth } from '../auth/AuthContext';
import { getAdminTournamentHistory } from '../api/tournaments';
import './TournamentAdminPage.css';

export function TournamentAdminPage() {
  const { user } = useAuth();
  const [trackId, setTrackId] = useState<string>(TRACKS[0].id);
  const [history, setHistory] = useState<TournamentAdminHistory | null>(null);
  const [created, setCreated] = useState<CreatedTournament | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await getAdminTournamentHistory());
      setError('');
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Could not load tournaments.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (user?.role === 'admin') void refreshHistory(); else setLoading(false); }, [refreshHistory, user?.role]);

  async function createTournament(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setCreating(true);
    setError('');
    try {
      const csrfResponse = await fetch('/api/auth/csrf', { credentials: 'include' });
      const csrfBody = await csrfResponse.json() as { csrfToken?: string; error?: { message?: string } };
      if (!csrfResponse.ok || !csrfBody.csrfToken) throw new Error(csrfBody.error?.message ?? 'Could not prepare tournament creation.');
      const response = await fetch('/api/tournaments', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfBody.csrfToken },
        body: JSON.stringify({ trackId }),
      });
      const body = await response.json() as { tournament?: unknown; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? 'Could not create tournament.');
      const parsed = CreatedTournamentSchema.safeParse(body.tournament);
      if (!parsed.success) throw new Error('Tournament response was invalid.');
      setCreated(parsed.data);
      await refreshHistory();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Could not create tournament.');
    } finally {
      setCreating(false);
    }
  }

  if (user?.role !== 'admin') return <section className="tournament-admin-page"><h1>Administrator access required</h1></section>;

  const lobbyUrl = created ? `${window.location.origin}/tournaments?code=${encodeURIComponent(created.joinCode)}` : '';

  return <section className="tournament-admin-page">
    <header className="tournament-admin-heading"><p className="eyebrow">ADMINISTRATION</p><h1>Tournament Management</h1><p>Create a private lobby and review its active or completed races.</p></header>
    <form className="tournament-admin-create" onSubmit={(event) => void createTournament(event)}>
      <div><h2>Create Tournament</h2><label htmlFor="admin-tournament-track">Track</label><select id="admin-tournament-track" value={trackId} onChange={(event) => setTrackId(event.target.value)}>{TRACKS.map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}</select></div>
      <button className="btn btn-primary" type="submit" disabled={creating}>{creating ? 'Creating…' : 'Create tournament'}</button>
    </form>
    {created && <section className="tournament-share-card" aria-live="polite"><div><p className="eyebrow">LOBBY CREATED</p><h2>Join code <strong className="lobby-code">{created.joinCode}</strong></h2><p>Share the code or lobby link with the players.</p></div><code>{lobbyUrl}</code><Link className="btn btn-secondary" to={`/tournaments?code=${encodeURIComponent(created.joinCode)}`}>Open lobby</Link></section>}
    {error && <p className="lobby-error" role="alert">{error}</p>}
    <section className="tournament-admin-list-section"><div className="tournament-admin-section-heading"><h2>Active tournaments</h2><button className="btn btn-secondary" type="button" onClick={() => void refreshHistory()} disabled={loading}>Refresh</button></div>
      {loading ? <p className="admin-empty">Loading tournaments…</p> : history?.active.length ? <div className="admin-tournament-list">{history.active.map((tournament) => {
        const trackName = TRACKS.find((track) => track.id === tournament.trackId)?.name ?? tournament.trackId;
        return <article className="admin-tournament-card" key={tournament.id}><div className="admin-tournament-card-heading"><div><h3>{trackName}</h3><p>Created {new Date(tournament.createdAt).toLocaleString()}</p></div><span className="status-badge">{tournament.status === 'starting' ? 'Starting' : 'Waiting'}</span></div><p>{tournament.players.length} / 6 players · Code <strong className="lobby-code">{tournament.joinCode}</strong></p><div className="admin-tournament-card-actions"><span>{tournament.players.map((player) => player.username).join(', ')}</span><Link to={`/tournaments?code=${encodeURIComponent(tournament.joinCode)}`}>Open lobby</Link></div></article>;
      })}</div> : <p className="admin-empty">No active tournaments.</p>}
    </section>
    <section className="tournament-admin-list-section"><h2>Completed tournaments</h2>
      {loading ? <p className="admin-empty">Loading results…</p> : history?.completed.length ? <div className="admin-tournament-list">{history.completed.map((tournament) => {
        const trackName = TRACKS.find((track) => track.id === tournament.trackId)?.name ?? tournament.trackId;
        const players = [...tournament.players].sort((a, b) => (a.placement ?? Number.MAX_SAFE_INTEGER) - (b.placement ?? Number.MAX_SAFE_INTEGER));
        return <article className="admin-tournament-card" key={tournament.tournamentId}><div className="admin-tournament-card-heading"><div><h3>{trackName}</h3><p>Completed {new Date(tournament.completedAt).toLocaleString()}</p></div><span className="status-badge">Complete</span></div><ol className="admin-result-list">{players.map((player) => <li key={player.username}><span>{player.placement === null ? 'DNF' : `${player.placement}.`} {player.username} · {CARS.find((car) => car.id === player.carId)?.name ?? player.carId}</span><span>{player.finishTimeSeconds === undefined ? 'Timed out' : `${player.finishTimeSeconds.toFixed(2)}s`}</span></li>)}</ol></article>;
      })}</div> : <p className="admin-empty">No completed tournaments.</p>}
    </section>
  </section>;
}
