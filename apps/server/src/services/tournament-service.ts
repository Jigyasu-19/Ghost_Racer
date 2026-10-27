import { getTrack } from '@ghost-racer/content';
import { TournamentAdminHistorySchema } from '@ghost-racer/contracts';
import { HttpError } from '../http/errors.js';
import { createTournamentRecord, findTournament, listHostTournamentIds, removeHostTournamentIndexEntry, serializeTournamentStatus, type StoredTournament } from '../persistence/tournament-repository.js';
import { findCompletedTournamentResults } from '../persistence/tournament-result-repository.js';

function redisUnavailable(): HttpError {
  return new HttpError(503, 'REDIS_UNAVAILABLE', 'Tournament storage is temporarily unavailable.');
}

export async function createTournament(hostUserId: string, hostUsername: string, trackId: string) {
  const track = getTrack(trackId);
  if (!track) throw new HttpError(400, 'TRACK_NOT_FOUND', 'The selected track does not exist.');
  try {
    return await createTournamentRecord(hostUserId, hostUsername, track.id);
  } catch (error: unknown) {
    console.error('Could not create tournament in Redis.', error);
    throw redisUnavailable();
  }
}

export async function getTournamentStatus(id: string, requesterUserId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, 'TOURNAMENT_NOT_FOUND', 'The tournament was not found.');
  let tournament: StoredTournament | null;
  try {
    tournament = await findTournament(id);
  } catch (error: unknown) {
    console.error('Could not read tournament from Redis.', error);
    throw redisUnavailable();
  }
  if (tournament === null || tournament.hostUserId !== requesterUserId) {
    throw new HttpError(404, 'TOURNAMENT_NOT_FOUND', 'The tournament was not found.');
  }
  return serializeTournamentStatus(tournament);
}

export async function getAdminTournamentHistory(hostUserId: string) {
  let ids: string[];
  let activeRecords: StoredTournament[];
  try {
    ids = await listHostTournamentIds(hostUserId);
    activeRecords = [];
    for (const id of ids) {
      const tournament = await findTournament(id);
      if (tournament === null || tournament.hostUserId !== hostUserId) {
        await removeHostTournamentIndexEntry(hostUserId, id);
        continue;
      }
      activeRecords.push(tournament);
    }
  } catch (error: unknown) {
    console.error('Could not read admin tournament lobbies from Redis.', error);
    throw redisUnavailable();
  }
  const completed = await findCompletedTournamentResults(hostUserId);
  const parsed = TournamentAdminHistorySchema.safeParse({
    active: activeRecords.map((tournament) => ({
      id: tournament.id, trackId: tournament.trackId, status: tournament.status,
      joinCode: tournament.joinCode, createdAt: tournament.createdAt, expiresAt: tournament.expiresAt,
      players: tournament.players.map(({ username, carId, ready }) => ({ username, carId, ready })),
    })),
    completed,
  });
  if (!parsed.success) throw new Error('Tournament history failed validation.');
  return parsed.data;
}
