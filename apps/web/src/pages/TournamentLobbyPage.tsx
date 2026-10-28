import { useEffect, useRef, useState, type FormEvent } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { LobbySnapshotSchema, CreatedTournamentSchema, SocketEvents, TournamentRaceResultSchema, TournamentRaceSnapshotSchema, type LobbySnapshot, type TournamentRaceResult, type TournamentRaceSnapshot } from '@ghost-racer/contracts';
import { CARS, TRACKS } from '@ghost-racer/content';
import type { RaceInput } from '@ghost-racer/game-core';
import { useAuth } from '../auth/AuthContext';
import { TournamentRaceCanvas } from '../race/TournamentRaceCanvas';
import './TournamentLobbyPage.css';

interface LobbyServerEvents {
  [SocketEvents.LOBBY_STATE]: (state: LobbySnapshot) => void;
  [SocketEvents.LOBBY_ERROR]: (error: { code: string; message: string }) => void;
  [SocketEvents.LOBBY_PLAYER_JOINED]: (event: { username: string }) => void;
  [SocketEvents.LOBBY_READINESS_CHANGED]: (event: { username: string; ready: boolean }) => void;
  [SocketEvents.LOBBY_RACE_STARTING]: (event: { lobbyId: string }) => void;
  [SocketEvents.RACE_SNAPSHOT]: (snapshot: TournamentRaceSnapshot) => void;
  [SocketEvents.RACE_FINISH]: (event: { lobbyId: string; username: string; finishTick: number }) => void;
  [SocketEvents.RACE_RESULT]: (result: TournamentRaceResult) => void;
}
interface LobbyClientEvents {
  [SocketEvents.LOBBY_JOIN]: (payload: { code: string }) => void;
  [SocketEvents.LOBBY_READY]: (payload: { lobbyId: string }) => void;
  [SocketEvents.LOBBY_UNREADY]: (payload: { lobbyId: string }) => void;
  [SocketEvents.LOBBY_START]: (payload: { lobbyId: string }) => void;
  [SocketEvents.LOBBY_CAR_SELECT]: (payload: { lobbyId: string; carId: string }) => void;
  [SocketEvents.RACE_INPUT]: (payload: { lobbyId: string; tick: number; input: RaceInput }) => void;
}
type LobbySocket = Socket<LobbyServerEvents, LobbyClientEvents>;

export function TournamentLobbyPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sharedCode = searchParams.get('code') ?? '';
  const socketRef = useRef<LobbySocket | null>(null);
  const attemptedSharedCode = useRef('');
  const latestServerTick = useRef(0);
  const nextInputTick = useRef(3);
  const [code, setCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [trackId, setTrackId] = useState<string>(TRACKS[0].id);
  const [lobby, setLobby] = useState<LobbySnapshot | null>(null);
  const [raceSnapshot, setRaceSnapshot] = useState<TournamentRaceSnapshot | null>(null);
  const [raceResult, setRaceResult] = useState<TournamentRaceResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => () => { socketRef.current?.disconnect(); }, []);
  useEffect(() => {
    if (!/^\d{4,5}$/.test(sharedCode) || attemptedSharedCode.current === sharedCode) return;
    attemptedSharedCode.current = sharedCode;
    setCode(sharedCode);
    setJoinCode(sharedCode);
    enterLobby(sharedCode);
  }, [sharedCode]);

  function enterLobby(joiningCode: string): void {
    socketRef.current?.disconnect();
    setLobby(null);
    setRaceSnapshot(null);
    setRaceResult(null);
    latestServerTick.current = 0;
    nextInputTick.current = 3;
    setError('');
    setNotice('Connecting to lobby…');
    const socket = io({ autoConnect: false, withCredentials: true }) as LobbySocket;
    socketRef.current = socket;
    socket.on('connect', () => socket.emit(SocketEvents.LOBBY_JOIN, { code: joiningCode }));
    socket.on(SocketEvents.LOBBY_STATE, (snapshot) => {
      const parsed = LobbySnapshotSchema.safeParse(snapshot);
      if (!parsed.success) { setError('The lobby returned invalid state.'); return; }
      setLobby(parsed.data);
      setNotice('');
    });
    socket.on(SocketEvents.LOBBY_ERROR, (event) => { setError(event.message); setNotice(''); });
    socket.on(SocketEvents.LOBBY_RACE_STARTING, () => setNotice('Race starting…'));
    socket.on(SocketEvents.RACE_SNAPSHOT, (snapshot) => {
      const parsed = TournamentRaceSnapshotSchema.safeParse(snapshot);
      if (!parsed.success) { setError('The race snapshot was invalid.'); return; }
      latestServerTick.current = parsed.data.tick;
      setRaceSnapshot(parsed.data);
      setNotice('');
    });
    socket.on(SocketEvents.RACE_FINISH, (event) => setNotice(`${event.username} finished.`));
    socket.on(SocketEvents.RACE_RESULT, (result) => {
      const parsed = TournamentRaceResultSchema.safeParse(result);
      if (!parsed.success) { setError('The race result was invalid.'); return; }
      setRaceResult(parsed.data);
      navigate(`/tournaments/${parsed.data.tournamentId}/podium`, { replace: true, state: { result: parsed.data } });
    });
    socket.on('connect_error', () => { setError('Could not connect to the lobby. Sign in again or retry.'); setNotice(''); });
    socket.connect();
  }

  async function submitJoin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const normalized = code.trim();
    if (!/^\d{4,5}$/.test(normalized)) { setError('Enter a valid 4- or 5-digit code.'); return; }
    setJoinCode(normalized);
    enterLobby(normalized);
  }

  async function createLobby(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
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
      setJoinCode(parsed.data.joinCode);
      enterLobby(parsed.data.joinCode);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Could not create tournament.');
    } finally {
      setBusy(false);
    }
  }

  const myPlayer = lobby?.players.find((player) => player.username === user?.username);
  const canStart = Boolean(myPlayer?.host && lobby && lobby.players.length >= 2 && lobby.players.every((player) => player.ready) && lobby.status === 'waiting');
  const trackName = lobby ? TRACKS.find((track) => track.id === lobby.trackId)?.name ?? lobby.trackId : '';

  function sendRaceInput(input: RaceInput): void {
    if (!lobby || raceResult) return;
    const tick = Math.max(nextInputTick.current, latestServerTick.current + 3);
    if (tick > 10_800) return;
    socketRef.current?.emit(SocketEvents.RACE_INPUT, { lobbyId: lobby.lobbyId, tick, input });
    nextInputTick.current = tick + 1;
  }

  return (
    <section className="tournament-page">
      <header className="tournament-heading"><p className="eyebrow">PRIVATE MULTIPLAYER</p><h1>Tournament Lobby</h1><p>Join with a host’s code, ready up, and wait for the host to start.</p></header>
      {raceSnapshot && lobby ? <div className="tournament-panel tournament-race-panel">
        <div className="lobby-title-row"><div><h2>{trackName} — Race</h2><p>Server tick {raceSnapshot.tick} · {(raceSnapshot.tick / 60).toFixed(2)} seconds</p></div><span className="status-badge">{raceResult ? 'Race complete' : 'Live race'}</span></div>
        <TournamentRaceCanvas trackId={raceSnapshot.trackId} snapshot={raceSnapshot} onInput={sendRaceInput} finished={raceResult !== null || Boolean(raceSnapshot.players.find((player) => player.username === user?.username && (player.raceComplete || player.timeout)))} />
        <ul className="lobby-player-list">{raceSnapshot.players.map((player) => <li key={player.username}><span className="lobby-player-name">{player.username} · {CARS.find((car) => car.id === player.carId)?.name ?? player.carId}</span><span className={player.raceComplete ? 'ready-indicator is-ready' : 'ready-indicator'}>{player.raceComplete ? `Finished · ${(player.finishTick! / 60).toFixed(2)}s` : player.timeout ? 'Timed out' : `Checkpoint ${player.checkpointIndex}/${TRACKS.find((track) => track.id === raceSnapshot.trackId)?.checkpoints.length ?? 0}`}</span></li>)}</ul>
        {raceResult && <p className="lobby-message" role="status">Results have been stored. The tournament podium will be available in the results screen.</p>}
      </div> : !lobby ? <div className="tournament-entry-grid">
        {user && <form className="tournament-panel" onSubmit={(event) => void createLobby(event)}>
          <h2>Host a tournament</h2><label htmlFor="tournament-track">Track</label>
          <select id="tournament-track" value={trackId} onChange={(event) => setTrackId(event.target.value)}>{TRACKS.map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}</select>
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create lobby'}</button>
        </form>}
        <form className="tournament-panel" onSubmit={(event) => void submitJoin(event)}>
          <h2>Join a tournament</h2><label htmlFor="join-code">Join code</label>
          <input id="join-code" inputMode="numeric" autoComplete="one-time-code" maxLength={5} pattern="\d{4,5}" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 5))} placeholder="4 or 5 digits" required />
          <button className="btn btn-primary" type="submit" disabled={Boolean(notice)}>{notice ? 'Joining…' : 'Join lobby'}</button>
        </form>
      </div> : <div className="tournament-panel lobby-panel">
        <div className="lobby-title-row"><div><h2>{trackName}</h2><p>{lobby.players.length} / 6 players · Lobby code <strong className="lobby-code">{joinCode}</strong></p></div><span className="status-badge">{lobby.status === 'starting' ? 'Race starting' : 'Waiting for players'}</span></div>
        <ul className="lobby-player-list">{lobby.players.map((player) => <li key={`${player.username}-${player.host}`}><span className="lobby-player-name">{player.username}{player.host && <span className="host-label">HOST</span>}</span><span className="lobby-player-options"><select aria-label={`${player.username} car`} value={player.carId} disabled={player.username !== user?.username || lobby.status !== 'waiting'} onChange={(event) => socketRef.current?.emit(SocketEvents.LOBBY_CAR_SELECT, { lobbyId: lobby.lobbyId, carId: event.target.value })}>{CARS.map((car) => <option key={car.id} value={car.id}>{car.name}</option>)}</select><span className={player.ready ? 'ready-indicator is-ready' : 'ready-indicator'}>{player.ready ? 'Ready' : 'Not ready'}</span></span></li>)}</ul>
        <div className="lobby-controls">
          <button className="btn btn-secondary" type="button" disabled={!myPlayer || lobby.status !== 'waiting'} onClick={() => socketRef.current?.emit(myPlayer?.ready ? SocketEvents.LOBBY_UNREADY : SocketEvents.LOBBY_READY, { lobbyId: lobby.lobbyId })}>{myPlayer?.ready ? 'Unready' : 'Ready up'}</button>
          {myPlayer?.host && <button className="btn btn-primary" type="button" disabled={!canStart} onClick={() => socketRef.current?.emit(SocketEvents.LOBBY_START, { lobbyId: lobby.lobbyId })}>Start</button>}
          {!myPlayer?.host && <p className="lobby-waiting-hint">The host will start the race when everyone is ready.</p>}
        </div>
      </div>}
      {notice && <p className="lobby-message" role="status">{notice}</p>}{error && <p className="lobby-error" role="alert">{error}</p>}
    </section>
  );
}
