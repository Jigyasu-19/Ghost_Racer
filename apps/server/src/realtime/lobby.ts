import { createHash } from 'node:crypto';
import { Server, type Socket } from 'socket.io';
import { getCar } from '@ghost-racer/content';
import { LobbyActionRequestSchema, LobbyJoinRequestSchema, LobbySnapshotSchema, RaceInputPayloadSchema, SocketEvents, TournamentCarSelectionSchema, type LobbySnapshot, type PublicUser } from '@ghost-racer/contracts';
import { getAuthenticatedUser } from '../services/auth-service.js';
import { checkJoinRateLimit, findTournament, findTournamentIdByCode, joinTournament, setTournamentCar, setTournamentReady, startTournament, type LobbyMutationResult, type StoredTournament } from '../persistence/tournament-repository.js';
import { queueTournamentInput, startTournamentRace } from '../services/tournament-race-service.js';

interface LobbySocketData { user: PublicUser; sessionToken: string; lobbyId?: string; lastRaceAuthCheckAt?: number; inputWindowAt?: number; inputWindowCount?: number }
interface LobbyServerEvents {
  [SocketEvents.LOBBY_ERROR]: (payload: { code: string; message: string }) => void;
  [SocketEvents.LOBBY_STATE]: (payload: LobbySnapshot) => void;
  [SocketEvents.LOBBY_PLAYER_JOINED]: (payload: { username: string }) => void;
  [SocketEvents.LOBBY_READINESS_CHANGED]: (payload: { username: string; ready: boolean }) => void;
  [SocketEvents.LOBBY_RACE_STARTING]: (payload: { lobbyId: string }) => void;
  [SocketEvents.RACE_SNAPSHOT]: (payload: import('@ghost-racer/contracts').TournamentRaceSnapshot) => void;
  [SocketEvents.RACE_FINISH]: (payload: { lobbyId: string; username: string; finishTick: number }) => void;
  [SocketEvents.RACE_RESULT]: (payload: import('@ghost-racer/contracts').TournamentRaceResult) => void;
}
type LobbySocket = Socket<Record<string, never>, LobbyServerEvents, Record<string, never>, LobbySocketData>;

function sessionToken(cookieHeader: string | undefined): string | null {
  if (cookieHeader === undefined) return null;
  for (const cookie of cookieHeader.split(';')) {
    const separator = cookie.indexOf('=');
    if (separator < 0 || cookie.slice(0, separator).trim() !== 'ghost_racer_session') continue;
    const value = cookie.slice(separator + 1).trim();
    return value.length > 0 ? value : null;
  }
  return null;
}

function snapshot(tournament: StoredTournament): LobbySnapshot {
  const parsed = LobbySnapshotSchema.safeParse({
    lobbyId: tournament.id,
    trackId: tournament.trackId,
    status: tournament.status,
    players: tournament.players.map(({ username, ready, host, carId }) => ({ username, ready, host, carId })),
  });
  if (!parsed.success) throw new Error('Tournament lobby state is invalid.');
  return parsed.data;
}

function emitError(socket: LobbySocket, code: string, message: string): void {
  socket.emit(SocketEvents.LOBBY_ERROR, { code, message });
}

async function refreshSession(socket: LobbySocket): Promise<PublicUser | null> {
  const user = await getAuthenticatedUser(socket.data.sessionToken);
  if (user !== null) socket.data.user = user;
  return user;
}

async function refreshRaceSession(socket: LobbySocket): Promise<PublicUser | null> {
  if (Date.now() - (socket.data.lastRaceAuthCheckAt ?? 0) < 5_000) return socket.data.user;
  const user = await refreshSession(socket);
  socket.data.lastRaceAuthCheckAt = Date.now();
  return user;
}

function mutationMessage(result: LobbyMutationResult): string {
  if (result === 'NOT_HOST') return 'Only the host can start this lobby.';
  if (result === 'NOT_READY') return 'At least two players must join and everyone must be ready.';
  if (result === 'LIMITED') return 'Too many join attempts. Please wait before trying again.';
  if (result === 'UNAVAILABLE') return 'This lobby is unavailable or full.';
  return 'The lobby action could not be completed.';
}

async function sendState(io: Server, lobbyId: string): Promise<void> {
  const tournament = await findTournament(lobbyId);
  if (tournament !== null) io.to(lobbyId).emit(SocketEvents.LOBBY_STATE, snapshot(tournament));
}

export function attachLobbySockets(io: Server): void {
  io.use((socket, next) => {
    const token = sessionToken(socket.handshake.headers.cookie);
    if (token === null) { next(new Error('Authentication is required.')); return; }
    void getAuthenticatedUser(token).then((user) => {
      if (user === null) { next(new Error('Authentication is required.')); return; }
      (socket.data as LobbySocketData).user = user;
      (socket.data as LobbySocketData).sessionToken = token;
      (socket.data as LobbySocketData).lastRaceAuthCheckAt = Date.now();
      next();
    }).catch(() => next(new Error('Authentication is unavailable.')));
  });

  io.on('connection', (rawSocket) => {
    const socket = rawSocket as LobbySocket;
    socket.on(SocketEvents.LOBBY_JOIN, (payload: unknown) => {
      void (async () => {
        const user = await refreshSession(socket);
        if (user === null) { emitError(socket, 'UNAUTHORIZED', 'Authentication is required.'); socket.disconnect(true); return; }
        const parsed = LobbyJoinRequestSchema.safeParse(payload);
        if (!parsed.success) { emitError(socket, 'INVALID_CODE', 'Enter a valid 4- or 5-digit code.'); return; }
        const ipHash = createHash('sha256').update(socket.handshake.address).digest('hex');
        const limit = await checkJoinRateLimit(user.id, ipHash);
        if (limit !== 'OK') { emitError(socket, limit === 'LIMITED' ? 'RATE_LIMITED' : 'LOBBY_UNAVAILABLE', mutationMessage(limit)); return; }
        const result = await joinTournament(parsed.data.code, user.id, user.username);
        if (result !== 'JOINED' && result !== 'EXISTING') { emitError(socket, 'LOBBY_UNAVAILABLE', mutationMessage(result)); return; }
        const lobbyId = await findTournamentIdByCode(parsed.data.code);
        if (lobbyId === null) { emitError(socket, 'LOBBY_UNAVAILABLE', mutationMessage('UNAVAILABLE')); return; }
        if (socket.data.lobbyId && socket.data.lobbyId !== lobbyId) await socket.leave(socket.data.lobbyId);
        socket.data.lobbyId = lobbyId;
        await socket.join(lobbyId);
        if (result === 'JOINED') io.to(lobbyId).emit(SocketEvents.LOBBY_PLAYER_JOINED, { username: user.username });
        await sendState(io, lobbyId);
      })().catch((error: unknown) => {
        console.error('Lobby join failed.', error);
        emitError(socket, 'LOBBY_UNAVAILABLE', 'The lobby is temporarily unavailable.');
      });
    });

    const setReady = (ready: boolean) => (payload: unknown) => {
      void (async () => {
        const user = await refreshSession(socket);
        if (user === null) { emitError(socket, 'UNAUTHORIZED', 'Authentication is required.'); socket.disconnect(true); return; }
        const parsed = LobbyActionRequestSchema.safeParse(payload);
        if (!parsed.success || parsed.data.lobbyId !== socket.data.lobbyId) { emitError(socket, 'LOBBY_UNAVAILABLE', 'Join this lobby before changing readiness.'); return; }
        const result = await setTournamentReady(parsed.data.lobbyId, user.id, ready);
        if (result !== 'OK') { emitError(socket, 'LOBBY_UNAVAILABLE', mutationMessage(result)); return; }
        io.to(parsed.data.lobbyId).emit(SocketEvents.LOBBY_READINESS_CHANGED, { username: user.username, ready });
        await sendState(io, parsed.data.lobbyId);
      })().catch((error: unknown) => {
        console.error('Lobby readiness update failed.', error);
        emitError(socket, 'LOBBY_UNAVAILABLE', 'The lobby is temporarily unavailable.');
      });
    };
    socket.on(SocketEvents.LOBBY_READY, setReady(true));
    socket.on(SocketEvents.LOBBY_UNREADY, setReady(false));

    socket.on(SocketEvents.LOBBY_CAR_SELECT, (payload: unknown) => {
      void (async () => {
        const user = await refreshSession(socket);
        if (user === null) { emitError(socket, 'UNAUTHORIZED', 'Authentication is required.'); socket.disconnect(true); return; }
        const parsed = TournamentCarSelectionSchema.safeParse(payload);
        const car = parsed.success ? getCar(parsed.data.carId) : undefined;
        if (!parsed.success || !car || parsed.data.lobbyId !== socket.data.lobbyId) { emitError(socket, 'INVALID_CAR', 'Choose a valid car while in the lobby.'); return; }
        const result = await setTournamentCar(parsed.data.lobbyId, user.id, car.id);
        if (result !== 'OK') { emitError(socket, 'LOBBY_UNAVAILABLE', mutationMessage(result)); return; }
        await sendState(io, parsed.data.lobbyId);
      })().catch((error: unknown) => {
        console.error('Lobby car selection failed.', error);
        emitError(socket, 'LOBBY_UNAVAILABLE', 'The lobby is temporarily unavailable.');
      });
    });

    socket.on(SocketEvents.LOBBY_START, (payload: unknown) => {
      void (async () => {
        const user = await refreshSession(socket);
        if (user === null) { emitError(socket, 'UNAUTHORIZED', 'Authentication is required.'); socket.disconnect(true); return; }
        const parsed = LobbyActionRequestSchema.safeParse(payload);
        if (!parsed.success || parsed.data.lobbyId !== socket.data.lobbyId) { emitError(socket, 'LOBBY_UNAVAILABLE', 'Join this lobby before starting it.'); return; }
        const result = await startTournament(parsed.data.lobbyId, user.id);
        if (result !== 'STARTED') { emitError(socket, result === 'NOT_HOST' ? 'HOST_ONLY' : 'NOT_READY', mutationMessage(result)); return; }
        io.to(parsed.data.lobbyId).emit(SocketEvents.LOBBY_RACE_STARTING, { lobbyId: parsed.data.lobbyId });
        await startTournamentRace(io, parsed.data.lobbyId);
      })().catch((error: unknown) => {
        console.error('Lobby start failed.', error);
        emitError(socket, 'LOBBY_UNAVAILABLE', 'The lobby is temporarily unavailable.');
      });
    });

    socket.on(SocketEvents.RACE_INPUT, (payload: unknown) => {
      void (async () => {
        const now = Date.now();
        if (now - (socket.data.inputWindowAt ?? 0) >= 1_000) { socket.data.inputWindowAt = now; socket.data.inputWindowCount = 0; }
        socket.data.inputWindowCount = (socket.data.inputWindowCount ?? 0) + 1;
        if (socket.data.inputWindowCount > 120) { socket.disconnect(true); return; }
        const parsed = RaceInputPayloadSchema.safeParse(payload);
        if (!parsed.success || parsed.data.lobbyId !== socket.data.lobbyId) return;
        const user = await refreshRaceSession(socket);
        if (user === null) { socket.disconnect(true); return; }
        queueTournamentInput(parsed.data.lobbyId, user.id, parsed.data.tick, parsed.data.input);
      })().catch((error: unknown) => console.error('Tournament race input failed.', error));
    });
  });
}
