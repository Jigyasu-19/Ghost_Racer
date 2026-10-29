import { CONTENT_VERSION, getCar, getTrack } from '@ghost-racer/content';
import type { CarDefinition, Line, Point, TrackDefinition } from '@ghost-racer/content';
import { EMPTY_INPUT, RACE_COUNTDOWN_SECONDS, SIMULATION_VERSION, TICK_RATE, createRaceState, step, type RaceInput, type RaceState } from '@ghost-racer/game-core';
import { TournamentRaceResultSchema, TournamentRaceSnapshotSchema, SocketEvents, type TournamentRaceResult, type TournamentRaceSnapshot } from '@ghost-racer/contracts';
import { Server } from 'socket.io';
import { cleanupTournament, findTournament, type StoredTournament } from '../persistence/tournament-repository.js';
import { saveTournamentResult } from '../persistence/tournament-result-repository.js';

const MAX_INPUT_LEAD_TICKS = 12;
const TICK_INTERVAL_MS = 1_000 / TICK_RATE;
// A racer whose client sends no input for this long is treated as disconnected and marked did-not-finish.
const INPUT_SILENCE_LIMIT_MS = 15_000;
// Once the first racer finishes, everyone else has this long to finish before the race is closed.
const FINISH_WINDOW_TICKS = 30 * TICK_RATE;

interface TournamentRacer {
  userId: string;
  username: string;
  carId: string;
  car: CarDefinition;
  state: RaceState;
  inputs: Map<number, RaceInput>;
  lastInputAt: number;
  finishProgress?: number;
}

interface RaceSession {
  lobby: StoredTournament;
  track: TrackDefinition;
  racers: TournamentRacer[];
  tick: number;
  firstFinishTick?: number;
  timer?: NodeJS.Timeout;
  lastTickAt: number;
  finalizing: boolean;
  result?: TournamentRaceResult;
  cleanupAttempts: number;
  persistenceRetryMs: number;
}

const activeRaces = new Map<string, RaceSession>();

function cross(a: Point, b: Point): number { return a.x * b.y - a.y * b.x; }

function distancePastFinish(previous: Point, state: RaceState, line: Line): number {
  const movement = { x: state.position.x - previous.x, y: state.position.y - previous.y };
  const finish = { x: line.end.x - line.start.x, y: line.end.y - line.start.y };
  const denominator = cross(movement, finish);
  if (denominator === 0) return 0;
  const offset = { x: line.start.x - previous.x, y: line.start.y - previous.y };
  const ratio = cross(offset, finish) / denominator;
  const intersection = { x: previous.x + movement.x * ratio, y: previous.y + movement.y * ratio };
  const direction = Math.sign(state.velocity) || 1;
  const trajectory = { x: Math.cos(state.headingRadians) * direction, y: Math.sin(state.headingRadians) * direction };
  return Math.max(0, (state.position.x - intersection.x) * trajectory.x + (state.position.y - intersection.y) * trajectory.y);
}

function snapshot(session: RaceSession): TournamentRaceSnapshot {
  const parsed = TournamentRaceSnapshotSchema.safeParse({
    lobbyId: session.lobby.id,
    trackId: session.track.id,
    tick: session.tick,
    players: session.racers.map(({ username, carId, state }) => ({
      username, carId, position: state.position, headingRadians: state.headingRadians, velocity: state.velocity,
      checkpointIndex: state.checkpointIndex, raceComplete: state.raceComplete, timeout: state.timeout,
      ...(state.finishTick === undefined ? {} : { finishTick: state.finishTick }),
    })),
  });
  if (!parsed.success) throw new Error('Tournament race snapshot failed validation.');
  return parsed.data;
}

function createResult(session: RaceSession): TournamentRaceResult {
  const finishers = session.racers.filter((racer) => racer.state.raceComplete).sort((left, right) => {
    const tickDifference = (left.state.finishTick ?? Number.MAX_SAFE_INTEGER) - (right.state.finishTick ?? Number.MAX_SAFE_INTEGER);
    if (tickDifference !== 0) return tickDifference;
    const progressDifference = (right.finishProgress ?? 0) - (left.finishProgress ?? 0);
    return progressDifference !== 0 ? progressDifference : left.userId.localeCompare(right.userId);
  });
  const placements = new Map(finishers.map((racer, index) => [racer.userId, index + 1]));
  const result = TournamentRaceResultSchema.safeParse({
    tournamentId: session.lobby.id,
    trackId: session.track.id,
    completedAt: new Date().toISOString(),
    simulationVersion: SIMULATION_VERSION,
    contentVersion: CONTENT_VERSION,
    players: session.racers.map((racer) => {
      const placement = placements.get(racer.userId) ?? null;
      return {
        username: racer.username,
        carId: racer.carId,
        placement,
        ...(racer.state.finishTick === undefined ? {} : { finishTick: racer.state.finishTick, finishTimeSeconds: racer.state.finishTick / TICK_RATE }),
        timeout: racer.state.timeout,
        checkpointIndex: racer.state.checkpointIndex,
      };
    }),
  });
  if (!result.success) throw new Error('Tournament race result failed validation.');
  return result.data;
}

async function persistAndCleanup(io: Server, session: RaceSession): Promise<void> {
  if (!session.result) session.result = createResult(session);
  try {
    const userIds = new Map(session.racers.map(({ userId, username }) => [username, userId]));
    await saveTournamentResult(session.result, userIds, session.lobby.hostUserId, session.lobby.createdAt);
  } catch (error: unknown) {
    session.persistenceRetryMs = Math.min(session.persistenceRetryMs * 2, 30_000);
    console.error('Tournament result persistence failed; retrying.', error);
    setTimeout(() => void persistAndCleanup(io, session), session.persistenceRetryMs);
    return;
  }

  activeRaces.delete(session.lobby.id);
  io.to(session.lobby.id).emit(SocketEvents.RACE_RESULT, session.result);
  try {
    await cleanupTournament(session.lobby.id, session.lobby.joinCode, session.lobby.hostUserId);
  } catch (error: unknown) {
    session.cleanupAttempts++;
    if (session.cleanupAttempts <= 8) {
      console.error('Tournament lobby cleanup failed; retrying.', error);
      setTimeout(() => void cleanupTournament(session.lobby.id, session.lobby.joinCode, session.lobby.hostUserId).catch((retryError: unknown) => console.error('Tournament lobby cleanup retry failed.', retryError)), Math.min(session.cleanupAttempts * 1_000, 10_000));
    } else console.error('Tournament lobby cleanup could not be completed; Redis TTL will expire it.', error);
  }
}

function stepRace(io: Server, session: RaceSession): void {
  if (session.finalizing) return;
  session.tick++;
  const now = performance.now();
  const finishWindowClosed = session.firstFinishTick !== undefined && session.tick - session.firstFinishTick >= FINISH_WINDOW_TICKS;
  for (const racer of session.racers) {
    if (racer.state.raceComplete || racer.state.timeout) continue;
    if (finishWindowClosed || now - racer.lastInputAt > INPUT_SILENCE_LIMIT_MS) {
      racer.state = { ...racer.state, timeout: true };
      continue;
    }
    const previous = racer.state.position;
    const input = racer.inputs.get(session.tick) ?? EMPTY_INPUT;
    racer.inputs.delete(session.tick);
    for (const queuedTick of racer.inputs.keys()) if (queuedTick < session.tick) racer.inputs.delete(queuedTick);
    racer.state = step(racer.state, input, session.track, racer.car);
    if (racer.state.raceComplete) {
      session.firstFinishTick ??= session.tick;
      racer.finishProgress = distancePastFinish(previous, racer.state, session.track.finishLine);
      io.to(session.lobby.id).emit(SocketEvents.RACE_FINISH, { lobbyId: session.lobby.id, username: racer.username, finishTick: racer.state.finishTick! });
    }
  }
  io.to(session.lobby.id).emit(SocketEvents.RACE_SNAPSHOT, snapshot(session));
  if (session.racers.every(({ state }) => state.raceComplete || state.timeout)) {
    session.finalizing = true;
    if (session.timer) clearInterval(session.timer);
    void persistAndCleanup(io, session);
  }
}

export async function startTournamentRace(io: Server, lobbyId: string): Promise<void> {
  if (activeRaces.has(lobbyId)) return;
  const lobby = await findTournament(lobbyId);
  if (lobby === null || lobby.status !== 'starting' || lobby.players.length < 2 || lobby.players.length > 6) {
    throw new Error('Tournament is not ready for simulation.');
  }
  const track = getTrack(lobby.trackId);
  if (!track) throw new Error('Tournament track is unavailable.');
  const racers = lobby.players.map((player) => {
    const car = getCar(player.carId);
    if (!car) throw new Error('Tournament car is unavailable.');
    return { userId: player.userId, username: player.username, carId: car.id, car, state: createRaceState(track), inputs: new Map<number, RaceInput>(), lastInputAt: performance.now() };
  });
  const session: RaceSession = { lobby, track, racers, tick: 0, lastTickAt: performance.now(), finalizing: false, cleanupAttempts: 0, persistenceRetryMs: 1_000 };
  setTimeout(() => {
    if (session.finalizing) return;
    session.lastTickAt = performance.now();
    for (const racer of session.racers) racer.lastInputAt = session.lastTickAt;
    session.timer = setInterval(() => {
      const now = performance.now();
      let catchupSteps = 0;
      while (now - session.lastTickAt >= TICK_INTERVAL_MS && catchupSteps < 6 && !session.finalizing) {
        session.lastTickAt += TICK_INTERVAL_MS;
        stepRace(io, session);
        catchupSteps++;
      }
    }, 5);
  }, RACE_COUNTDOWN_SECONDS * 1000);
  activeRaces.set(lobbyId, session);
  io.to(lobbyId).emit(SocketEvents.RACE_SNAPSHOT, snapshot(session));
}

export function queueTournamentInput(lobbyId: string, userId: string, tick: number, input: RaceInput): boolean {
  const session = activeRaces.get(lobbyId);
  if (!session || session.finalizing) return false;
  const racer = session.racers.find((candidate) => candidate.userId === userId);
  if (!racer || racer.state.raceComplete || racer.state.timeout) return false;
  const inputTick = Math.max(tick, session.tick + 1);
  if (inputTick > session.tick + MAX_INPUT_LEAD_TICKS) return false;
  racer.lastInputAt = performance.now();
  racer.inputs.set(inputTick, input);
  return true;
}
