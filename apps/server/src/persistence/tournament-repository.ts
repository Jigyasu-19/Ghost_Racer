import { randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CreatedTournamentSchema, TournamentLobbySchema, type CreatedTournament } from '@ghost-racer/contracts';
import { getRedisClient } from './redis.js';

export const TOURNAMENT_LOBBY_TTL_SECONDS = 60 * 60;

const StoredTournamentSchema = TournamentLobbySchema.extend({
  hostUserId: z.string().regex(/^[a-f\d]{24}$/i),
  players: z.array(z.object({ userId: z.string().regex(/^[a-f\d]{24}$/i), username: z.string().min(3).max(24), ready: z.boolean(), host: z.boolean(), carId: z.string().min(1).max(64).default('sprinter_01') }).strict()).min(1).max(6),
  joinCode: z.string().regex(/^\d{4,5}$/),
}).strict();
export type StoredTournament = z.infer<typeof StoredTournamentSchema>;

const RATE_LIMIT_SCRIPT = `local userCount = redis.call('INCR', KEYS[1]); if userCount == 1 then redis.call('EXPIRE', KEYS[1], 60) end; local ipCount = redis.call('INCR', KEYS[2]); if ipCount == 1 then redis.call('EXPIRE', KEYS[2], 60) end; if userCount > 10 or ipCount > 10 then return 'LIMITED' end; return 'OK'`;
const JOIN_SCRIPT = `local codeLobby = redis.call('GET', KEYS[2]); if codeLobby ~= ARGV[1] then return 'UNAVAILABLE' end; local raw = redis.call('GET', KEYS[1]); if not raw then return 'UNAVAILABLE' end; local lobby = cjson.decode(raw); if lobby.status ~= 'waiting' then return 'UNAVAILABLE' end; local found = false; for _, player in ipairs(lobby.players) do if player.userId == ARGV[2] then found = true end end; if not found then if #lobby.players >= 6 then return 'UNAVAILABLE' end; table.insert(lobby.players, {userId=ARGV[2], username=ARGV[3], ready=false, host=false, carId='sprinter_01'}) end; local ttl = redis.call('PTTL', KEYS[1]); if ttl > 0 then redis.call('SET', KEYS[1], cjson.encode(lobby), 'PX', ttl) else return 'UNAVAILABLE' end; return found and 'EXISTING' or 'JOINED'`;
const READY_SCRIPT = `local raw = redis.call('GET', KEYS[1]); if not raw then return 'UNAVAILABLE' end; local lobby = cjson.decode(raw); if lobby.status ~= 'waiting' then return 'UNAVAILABLE' end; local found = false; for _, player in ipairs(lobby.players) do if player.userId == ARGV[1] then player.ready = ARGV[2] == 'true'; found = true end end; if not found then return 'UNAVAILABLE' end; local ttl = redis.call('PTTL', KEYS[1]); if ttl > 0 then redis.call('SET', KEYS[1], cjson.encode(lobby), 'PX', ttl) else return 'UNAVAILABLE' end; return 'OK'`;
const START_SCRIPT = `local raw = redis.call('GET', KEYS[1]); if not raw then return 'UNAVAILABLE' end; local lobby = cjson.decode(raw); if lobby.hostUserId ~= ARGV[1] then return 'NOT_HOST' end; if lobby.status ~= 'waiting' then return 'UNAVAILABLE' end; if #lobby.players < 2 then return 'NOT_READY' end; for _, player in ipairs(lobby.players) do if not player.ready then return 'NOT_READY' end end; lobby.status = 'starting'; local ttl = redis.call('PTTL', KEYS[1]); if ttl > 0 then redis.call('SET', KEYS[1], cjson.encode(lobby), 'PX', ttl) else return 'UNAVAILABLE' end; return 'STARTED'`;
const CAR_SCRIPT = `local raw = redis.call('GET', KEYS[1]); if not raw then return 'UNAVAILABLE' end; local lobby = cjson.decode(raw); if lobby.status ~= 'waiting' then return 'UNAVAILABLE' end; local found = false; for _, player in ipairs(lobby.players) do if player.userId == ARGV[1] then player.carId = ARGV[2]; found = true end end; if not found then return 'UNAVAILABLE' end; local ttl = redis.call('PTTL', KEYS[1]); if ttl > 0 then redis.call('SET', KEYS[1], cjson.encode(lobby), 'PX', ttl) else return 'UNAVAILABLE' end; return 'OK'`;
const CLEANUP_SCRIPT = `redis.call('DEL', KEYS[1]); if redis.call('GET', KEYS[2]) == ARGV[1] then redis.call('DEL', KEYS[2]) end; redis.call('SREM', KEYS[3], ARGV[1]); return 'OK'`;
const HOST_INDEX_ADD_SCRIPT = `redis.call('SADD', KEYS[1], ARGV[1]); redis.call('EXPIRE', KEYS[1], ARGV[2]); return 'OK'`;
const HOST_INDEX_LIST_SCRIPT = `local ids = redis.call('SMEMBERS', KEYS[1]); local values = {}; for i, id in ipairs(ids) do values[i] = cjson.encode(id) end; return '[' .. table.concat(values, ',') .. ']'`;
const HOST_INDEX_REMOVE_SCRIPT = `redis.call('SREM', KEYS[1], ARGV[1]); return 'OK'`;

function makeJoinCode(): string {
  return randomInt(0, 2) === 0
    ? String(randomInt(1_000, 10_000))
    : String(randomInt(10_000, 100_000));
}

function lobbyKey(id: string): string { return `tournament:${id}`; }
function codeKey(code: string): string { return `tournament:join-code:${code}`; }
function hostIndexKey(hostUserId: string): string { return `tournament:host:${hostUserId}`; }

export async function createTournamentRecord(hostUserId: string, hostUsername: string, trackId: string): Promise<CreatedTournament> {
  const redis = await getRedisClient();
  for (let attempt = 0; attempt < 64; attempt++) {
    const id = randomUUID();
    const joinCode = makeJoinCode();
    const codeStored = await redis.set(codeKey(joinCode), id, { EX: TOURNAMENT_LOBBY_TTL_SECONDS, NX: true });
    if (codeStored !== 'OK') continue;

    const createdAt = new Date();
    const tournament: StoredTournament = {
      id,
      hostUserId,
      players: [{ userId: hostUserId, username: hostUsername, ready: false, host: true, carId: 'sprinter_01' }],
      trackId,
      joinCode,
      status: 'waiting',
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + TOURNAMENT_LOBBY_TTL_SECONDS * 1_000).toISOString(),
    };
    let stored: string | null;
    try {
      stored = await redis.set(lobbyKey(id), JSON.stringify(tournament), { EX: TOURNAMENT_LOBBY_TTL_SECONDS, NX: true });
    } catch (error: unknown) {
      await redis.del(codeKey(joinCode)).catch(() => undefined);
      throw error;
    }
    if (stored !== 'OK') {
      await redis.del(codeKey(joinCode));
      continue;
    }
    const response = CreatedTournamentSchema.safeParse({
      id: tournament.id, trackId: tournament.trackId, joinCode: tournament.joinCode,
      status: tournament.status, createdAt: tournament.createdAt, expiresAt: tournament.expiresAt,
    });
    if (!response.success) {
      await redis.del([lobbyKey(id), codeKey(joinCode)]);
      throw new Error('Created tournament metadata failed validation.');
    }
    try {
      await redis.eval(HOST_INDEX_ADD_SCRIPT, [hostIndexKey(hostUserId)], [id, String(TOURNAMENT_LOBBY_TTL_SECONDS)]);
    } catch (error: unknown) {
      await redis.del([lobbyKey(id), codeKey(joinCode)]).catch(() => undefined);
      throw error;
    }
    return response.data;
  }
  throw new Error('Unable to allocate a unique tournament join code.');
}

export async function findTournament(id: string): Promise<StoredTournament | null> {
  const redis = await getRedisClient();
  const value = await redis.get(lobbyKey(id));
  if (value === null) return null;
  let record: unknown;
  try {
    record = JSON.parse(value) as unknown;
  } catch {
    throw new Error('Stored tournament metadata is invalid.');
  }
  const parsed = StoredTournamentSchema.safeParse(record);
  if (!parsed.success) throw new Error('Stored tournament metadata is invalid.');
  return parsed.data;
}

export type LobbyMutationResult = 'OK' | 'JOINED' | 'EXISTING' | 'STARTED' | 'NOT_HOST' | 'NOT_READY' | 'UNAVAILABLE' | 'LIMITED';

export async function checkJoinRateLimit(userId: string, ipHash: string): Promise<LobbyMutationResult> {
  const redis = await getRedisClient();
  return await redis.eval(RATE_LIMIT_SCRIPT, [`tournament:join-rate:user:${userId}`, `tournament:join-rate:ip:${ipHash}`], []) as LobbyMutationResult ?? 'UNAVAILABLE';
}

export async function joinTournament(code: string, userId: string, username: string): Promise<LobbyMutationResult> {
  const redis = await getRedisClient();
  const id = await redis.get(codeKey(code));
  if (id === null) return 'UNAVAILABLE';
  return await redis.eval(JOIN_SCRIPT, [lobbyKey(id), codeKey(code)], [id, userId, username]) as LobbyMutationResult ?? 'UNAVAILABLE';
}

export async function findTournamentIdByCode(code: string): Promise<string | null> {
  const redis = await getRedisClient();
  return redis.get(codeKey(code));
}

export async function setTournamentReady(id: string, userId: string, ready: boolean): Promise<LobbyMutationResult> {
  const redis = await getRedisClient();
  return await redis.eval(READY_SCRIPT, [lobbyKey(id)], [userId, String(ready)]) as LobbyMutationResult ?? 'UNAVAILABLE';
}

export async function startTournament(id: string, userId: string): Promise<LobbyMutationResult> {
  const redis = await getRedisClient();
  return await redis.eval(START_SCRIPT, [lobbyKey(id)], [userId]) as LobbyMutationResult ?? 'UNAVAILABLE';
}

export async function setTournamentCar(id: string, userId: string, carId: string): Promise<LobbyMutationResult> {
  const redis = await getRedisClient();
  return await redis.eval(CAR_SCRIPT, [lobbyKey(id)], [userId, carId]) as LobbyMutationResult ?? 'UNAVAILABLE';
}

export async function cleanupTournament(id: string, joinCode: string, hostUserId: string): Promise<void> {
  const redis = await getRedisClient();
  await redis.eval(CLEANUP_SCRIPT, [lobbyKey(id), codeKey(joinCode), hostIndexKey(hostUserId)], [id]);
}

export async function removeHostTournamentIndexEntry(hostUserId: string, tournamentId: string): Promise<void> {
  const redis = await getRedisClient();
  await redis.eval(HOST_INDEX_REMOVE_SCRIPT, [hostIndexKey(hostUserId)], [tournamentId]);
}

export async function listHostTournamentIds(hostUserId: string): Promise<string[]> {
  const redis = await getRedisClient();
  const value = await redis.eval(HOST_INDEX_LIST_SCRIPT, [hostIndexKey(hostUserId)], []);
  if (value === null) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(value) as unknown; } catch { throw new Error('Tournament host index is invalid.'); }
  if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id))) {
    throw new Error('Tournament host index is invalid.');
  }
  return parsed;
}

export function serializeTournamentStatus(tournament: StoredTournament) {
  const parsed = TournamentLobbySchema.safeParse({
    id: tournament.id, trackId: tournament.trackId, status: tournament.status,
    createdAt: tournament.createdAt, expiresAt: tournament.expiresAt,
  });
  if (!parsed.success) throw new Error('Tournament status failed validation.');
  return parsed.data;
}
