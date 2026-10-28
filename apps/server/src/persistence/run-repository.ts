import { ObjectId, type Collection } from 'mongodb';
import { CONTENT_VERSION } from '@ghost-racer/content';
import { SIMULATION_VERSION } from '@ghost-racer/game-core';
import { connectToMongo } from './mongo.js';

const currentRules = { simulationVersion: SIMULATION_VERSION, contentVersion: CONTENT_VERSION };
export const isOutdatedBestRun = (run: Pick<BestRunDocument, 'simulationVersion' | 'contentVersion'>): boolean => run.simulationVersion !== SIMULATION_VERSION || run.contentVersion !== CONTENT_VERSION;

export interface BestRunDocument {
  _id: ObjectId;
  userId: ObjectId;
  trackId: string;
  carId: string;
  verifiedFinishTime: number;
  replayObjectKey: string;
  replayChecksum: string;
  simulationVersion: string;
  contentVersion: string;
  createdAt: Date;
  updatedAt: Date;
}

async function bestRuns(): Promise<Collection<BestRunDocument>> {
  return (await connectToMongo()).collection<BestRunDocument>('bestRuns');
}

export async function ensureBestRunIndexes(): Promise<void> {
  const collection = await bestRuns();
  await Promise.all([
    collection.createIndex({ userId: 1, trackId: 1, carId: 1 }, { unique: true, name: 'unique_user_track_car_best' }),
    collection.createIndex({ trackId: 1, carId: 1, verifiedFinishTime: 1 }, { name: 'leaderboard_track_car_time' }),
  ]);
}

export async function insertBestRunIfAbsent(run: BestRunDocument): Promise<'inserted' | 'exists'> {
  try {
    await (await bestRuns()).insertOne(run);
    return 'inserted';
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) return 'exists';
    throw error;
  }
}

export async function replaceBestRunIfFaster(run: BestRunDocument): Promise<string | null> {
  const collection = await bestRuns();
  const previous = await collection.findOneAndUpdate(
    { userId: run.userId, trackId: run.trackId, carId: run.carId, $or: [{ verifiedFinishTime: { $gt: run.verifiedFinishTime } }, { simulationVersion: { $ne: SIMULATION_VERSION } }, { contentVersion: { $ne: CONTENT_VERSION } }] },
    { $set: { verifiedFinishTime: run.verifiedFinishTime, replayObjectKey: run.replayObjectKey, replayChecksum: run.replayChecksum, simulationVersion: run.simulationVersion, contentVersion: run.contentVersion, updatedAt: run.updatedAt } },
    { returnDocument: 'before' },
  );
  return previous?.replayObjectKey ?? null;
}

export async function listBestRunsForUser(userId: ObjectId): Promise<BestRunDocument[]> {
  return (await bestRuns()).find({ userId }).sort({ updatedAt: -1 }).toArray();
}

export async function findBestRunForUser(runId: ObjectId, userId: ObjectId): Promise<BestRunDocument | null> {
  return (await bestRuns()).findOne({ _id: runId, userId });
}

export async function listReferencedReplayKeys(): Promise<Set<string>> {
  const keys = await (await bestRuns()).distinct('replayObjectKey');
  if (!keys.every((key): key is string => typeof key === 'string')) throw new Error('Stored replay keys are invalid.');
  return new Set(keys);
}

export async function deleteOutdatedBestRuns(olderThan: Date): Promise<string[]> {
  const collection = await bestRuns();
  const outdated = { updatedAt: { $lt: olderThan }, $or: [{ simulationVersion: { $ne: SIMULATION_VERSION } }, { contentVersion: { $ne: CONTENT_VERSION } }] };
  const keys = await collection.distinct('replayObjectKey', outdated);
  if (keys.length > 0) await collection.deleteMany(outdated);
  return keys.filter((key): key is string => typeof key === 'string');
}

export async function findBestRunById(runId: ObjectId): Promise<BestRunDocument | null> {
  return (await bestRuns()).findOne({ _id: runId });
}

export async function isBestRunInTopTen(run: Pick<BestRunDocument, '_id' | 'trackId' | 'carId'>): Promise<boolean> {
  const records = await (await bestRuns())
    .find({ trackId: run.trackId, carId: run.carId, ...currentRules })
    .sort({ verifiedFinishTime: 1, _id: 1 })
    .limit(10)
    .project<{ _id: ObjectId }>({ _id: 1 })
    .toArray();
  return records.some((record) => record._id.equals(run._id));
}

export interface LeaderboardRun {
  runId: string;
  rank: number;
  username: string;
  time: number;
}

export async function findTopRuns(trackId: string, carId: string): Promise<LeaderboardRun[]> {
  const records = await (await bestRuns())
    .find({ trackId, carId, ...currentRules })
    .sort({ verifiedFinishTime: 1, _id: 1 })
    .limit(10)
    .toArray();
  if (records.length === 0) return [];

  const users = await (await connectToMongo()).collection<{ _id: ObjectId; username: string }>('users')
    .find({ _id: { $in: records.map((record) => record.userId) } }, { projection: { username: 1 } })
    .toArray();
  const usernames = new Map(users.map((user) => [user._id.toHexString(), user.username]));
  return records.flatMap((record, index) => {
    const username = usernames.get(record.userId.toHexString());
    return username === undefined ? [] : [{ runId: record._id.toHexString(), rank: index + 1, username, time: record.verifiedFinishTime }];
  });
}
