import { gunzipSync } from 'node:zlib';
import { ObjectId } from 'mongodb';
import { CONTENT_VERSION, getCar, getTrack } from '@ghost-racer/content';
import { CompressedReplaySchema, type RunReplayMetadata } from '@ghost-racer/contracts';
import { SIMULATION_VERSION, createRaceState, step } from '@ghost-racer/game-core';
import { HttpError } from '../http/errors.js';
import { findBestRunById, findBestRunForUser, insertBestRunIfAbsent, isBestRunInTopTen, listBestRunsForUser, replaceBestRunIfFaster, type BestRunDocument } from '../persistence/run-repository.js';
import { replayStorage } from '../persistence/replay-storage.js';

export interface SubmitRunResult {
  newPersonalBest: boolean;
  verifiedFinishTime: number;
}

export interface PersonalBestSummary {
  runId: string;
  trackId: string;
  carId: string;
  verifiedFinishTime: number;
  createdAt: string;
  updatedAt: string;
}

function toPersonalBestSummary(run: BestRunDocument): PersonalBestSummary {
  return { runId: run._id.toHexString(), trackId: run.trackId, carId: run.carId, verifiedFinishTime: run.verifiedFinishTime, createdAt: run.createdAt.toISOString(), updatedAt: run.updatedAt.toISOString() };
}

export async function getPersonalBests(userId: string): Promise<PersonalBestSummary[]> {
  if (!/^[a-f\d]{24}$/i.test(userId)) throw new HttpError(401, 'UNAUTHORIZED', 'Authentication is required.');
  return (await listBestRunsForUser(new ObjectId(userId))).map(toPersonalBestSummary);
}

export async function getPersonalBestReplay(userId: string, runId: string): Promise<Buffer> {
  if (!/^[a-f\d]{24}$/i.test(userId) || !/^[a-f\d]{24}$/i.test(runId)) {
    throw new HttpError(404, 'RUN_NOT_FOUND', 'The personal best replay was not found.');
  }
  const id = new ObjectId(runId);
  const ownerId = new ObjectId(userId);
  const ownedRun = await findBestRunForUser(id, ownerId);
  if (ownedRun) return replayStorage.get(ownedRun.replayObjectKey);

  const run = await findBestRunById(id);
  if (run === null || !(await isBestRunInTopTen(run))) {
    throw new HttpError(404, 'RUN_NOT_FOUND', 'The replay was not found.');
  }
  return replayStorage.get(run.replayObjectKey);
}

export async function submitSoloRun(userId: string, metadata: RunReplayMetadata, compressedReplay: Buffer): Promise<SubmitRunResult> {
  if (compressedReplay.byteLength === 0 || compressedReplay.byteLength > 1_000_000) {
    throw new HttpError(413, 'REPLAY_SIZE_INVALID', 'The compressed replay must be between 1 byte and 1 MB.');
  }
  if (metadata.simulationVersion !== SIMULATION_VERSION || metadata.contentVersion !== CONTENT_VERSION) {
    throw new HttpError(422, 'REPLAY_VERSION_UNSUPPORTED', 'The replay uses unsupported simulation or content rules.');
  }
  const track = getTrack(metadata.trackId);
  const car = getCar(metadata.carId);
  if (!track || !car) throw new HttpError(422, 'CONTENT_NOT_FOUND', 'The replay track or car does not exist.');

  let replayJson: unknown;
  try {
    replayJson = JSON.parse(gunzipSync(compressedReplay, { maxOutputLength: 2_000_000 }).toString('utf8')) as unknown;
  } catch {
    throw new HttpError(400, 'REPLAY_INVALID', 'The compressed replay is invalid.');
  }
  const parsedReplay = CompressedReplaySchema.safeParse(replayJson);
  if (!parsedReplay.success) throw new HttpError(400, 'REPLAY_INVALID', 'The replay input sequence is invalid.');
  const replay = parsedReplay.data;
  if (replay.trackId !== metadata.trackId || replay.carId !== metadata.carId || replay.simulationVersion !== metadata.simulationVersion || replay.contentVersion !== metadata.contentVersion) {
    throw new HttpError(422, 'REPLAY_METADATA_MISMATCH', 'The replay metadata does not match the submission.');
  }

  let state = createRaceState(track);
  for (let index = 0; index < replay.inputs.length; index++) {
    const entry = replay.inputs[index]!;
    if (entry.tick !== index + 1 || entry.tick !== state.tick + 1 || state.raceComplete || state.timeout) {
      throw new HttpError(422, 'REPLAY_TICK_SEQUENCE_INVALID', 'Replay inputs must contain one ordered input for each simulation tick.');
    }
    state = step(state, entry.input, track, car);
    if (state.raceComplete && index !== replay.inputs.length - 1) {
      throw new HttpError(422, 'REPLAY_HAS_TRAILING_INPUTS', 'A replay cannot include inputs after the finish.');
    }
  }
  if (!state.raceComplete || state.finishTick === undefined) {
    throw new HttpError(422, 'RACE_NOT_FINISHED', 'The replay does not contain a valid checkpoint sequence and finish.');
  }

  const storedReplay = await replayStorage.put(compressedReplay);
  const now = new Date();
  const run: BestRunDocument = {
    _id: new ObjectId(), userId: new ObjectId(userId), trackId: track.id, carId: car.id,
    verifiedFinishTime: state.finishTick / 60, replayObjectKey: storedReplay.objectKey, replayChecksum: storedReplay.checksum,
    simulationVersion: replay.simulationVersion, contentVersion: replay.contentVersion, createdAt: now, updatedAt: now,
  };

  try {
    const insertResult = await insertBestRunIfAbsent(run);
    if (insertResult === 'inserted') return { newPersonalBest: true, verifiedFinishTime: run.verifiedFinishTime };

    const replacedObjectKey = await replaceBestRunIfFaster(run);
    if (replacedObjectKey === null) {
      await replayStorage.delete(storedReplay.objectKey);
      return { newPersonalBest: false, verifiedFinishTime: run.verifiedFinishTime };
    }
    void replayStorage.delete(replacedObjectKey).catch((error: unknown) => console.error('Could not remove replaced replay file.', error));
    return { newPersonalBest: true, verifiedFinishTime: run.verifiedFinishTime };
  } catch (error: unknown) {
    await replayStorage.delete(storedReplay.objectKey).catch((cleanupError: unknown) => console.error('Could not remove unreferenced replay file.', cleanupError));
    throw error;
  }
}
