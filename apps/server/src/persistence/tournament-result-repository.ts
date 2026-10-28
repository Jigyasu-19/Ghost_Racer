import { ObjectId, type Collection } from 'mongodb';
import { TournamentRaceResultSchema, type TournamentRaceResult } from '@ghost-racer/contracts';
import { connectToMongo } from './mongo.js';

interface TournamentResultDocument {
  _id: string;
  tournamentId: string;
  hostUserId: ObjectId;
  trackId: string;
  status: 'complete';
  createdAt: Date;
  completedAt: Date;
  simulationVersion: string;
  contentVersion: string;
  players: Array<{
    userId: ObjectId;
    username: string;
    carId: string;
    placement: number | null;
    finishTick?: number;
    finishTimeSeconds?: number;
    timeout: boolean;
    checkpointIndex: number;
  }>;
}

async function results(): Promise<Collection<TournamentResultDocument>> {
  return (await connectToMongo()).collection<TournamentResultDocument>('tournamentResults');
}

export async function saveTournamentResult(result: TournamentRaceResult, userIds: ReadonlyMap<string, string>, hostUserId: string, createdAt: string): Promise<void> {
  if (!ObjectId.isValid(hostUserId)) throw new Error('Tournament host identity is invalid.');
  const players = result.players.map((player) => {
    const userId = userIds.get(player.username);
    if (userId === undefined || !ObjectId.isValid(userId)) throw new Error('Tournament participant identity is invalid.');
    return { ...player, userId: new ObjectId(userId) };
  });
  const document: TournamentResultDocument = {
    _id: result.tournamentId,
    tournamentId: result.tournamentId,
    hostUserId: new ObjectId(hostUserId),
    trackId: result.trackId,
    status: 'complete',
    createdAt: new Date(createdAt),
    completedAt: new Date(result.completedAt),
    simulationVersion: result.simulationVersion,
    contentVersion: result.contentVersion,
    players,
  };
  await (await results()).updateOne({ _id: result.tournamentId }, { $setOnInsert: document }, { upsert: true });
}

function toResult(document: TournamentResultDocument): TournamentRaceResult {
  const parsed = TournamentRaceResultSchema.safeParse({
    tournamentId: document.tournamentId,
    trackId: document.trackId,
    completedAt: document.completedAt.toISOString(),
    simulationVersion: document.simulationVersion,
    contentVersion: document.contentVersion,
    players: document.players.map((player) => ({
      username: player.username,
      carId: player.carId,
      placement: player.placement,
      ...(player.finishTick === undefined ? {} : { finishTick: player.finishTick }),
      ...(player.finishTimeSeconds === undefined ? {} : { finishTimeSeconds: player.finishTimeSeconds }),
      timeout: player.timeout,
      checkpointIndex: player.checkpointIndex,
    })),
  });
  if (!parsed.success) throw new Error('Stored tournament result failed validation.');
  return parsed.data;
}

export async function findCompletedTournamentResults(hostUserId: string): Promise<TournamentRaceResult[]> {
  if (!ObjectId.isValid(hostUserId)) return [];
  const documents = await (await results()).find({ hostUserId: new ObjectId(hostUserId) }).sort({ completedAt: -1 }).toArray();
  return documents.map(toResult);
}

export async function findTournamentResultForParticipant(tournamentId: string, userId: string): Promise<TournamentRaceResult | null> {
  if (!ObjectId.isValid(userId)) return null;
  const id = new ObjectId(userId);
  const document = await (await results()).findOne({ _id: tournamentId, $or: [{ hostUserId: id }, { 'players.userId': id }] });
  return document === null ? null : toResult(document);
}
