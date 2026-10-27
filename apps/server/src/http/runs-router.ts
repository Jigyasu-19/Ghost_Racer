import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { RunReplayMetadataSchema } from '@ghost-racer/contracts';
import { getAuthenticatedUser } from '../services/auth-service.js';
import { getPersonalBestReplay, getPersonalBests, submitSoloRun } from '../services/run-service.js';
import { readCookie, requireCsrfToken } from './csrf.js';
import { HttpError, sendError } from './errors.js';

const SESSION_COOKIE_NAME = 'ghost_racer_session';
export const runsRouter = Router();

runsRouter.get('/my-bests', async (request, response, next) => {
  try {
    const sessionToken = readCookie(request, SESSION_COOKIE_NAME);
    const user = sessionToken === undefined ? null : await getAuthenticatedUser(sessionToken);
    if (user === null) {
      sendError(response, 401, 'UNAUTHORIZED', 'Authentication is required.');
      return;
    }
    response.setHeader('Cache-Control', 'private, no-store');
    response.json({ runs: await getPersonalBests(user.id) });
  } catch (error: unknown) {
    next(error);
  }
});

runsRouter.get('/:runId/replay', async (request, response, next) => {
  try {
    const sessionToken = readCookie(request, SESSION_COOKIE_NAME);
    const user = sessionToken === undefined ? null : await getAuthenticatedUser(sessionToken);
    if (user === null) {
      sendError(response, 401, 'UNAUTHORIZED', 'Authentication is required.');
      return;
    }
    const replay = await getPersonalBestReplay(user.id, request.params.runId ?? '');
    response.setHeader('Cache-Control', 'private, no-store');
    response.type('application/gzip').send(replay);
  } catch (error: unknown) {
    next(error);
  }
});

runsRouter.post('/submit', express.raw({ type: 'application/gzip', limit: '1mb' }), requireCsrfToken, async (request, response, next) => {
  try {
    const sessionToken = readCookie(request, SESSION_COOKIE_NAME);
    const user = sessionToken === undefined ? null : await getAuthenticatedUser(sessionToken);
    if (user === null) {
      sendError(response, 401, 'UNAUTHORIZED', 'Authentication is required.');
      return;
    }
    if (!Buffer.isBuffer(request.body)) {
      sendError(response, 400, 'REPLAY_REQUIRED', 'A gzip-compressed replay is required.');
      return;
    }
    const metadata = RunReplayMetadataSchema.safeParse(request.query);
    if (!metadata.success) {
      sendError(response, 400, 'VALIDATION_ERROR', 'Replay metadata is invalid.');
      return;
    }
    const result = await submitSoloRun(user.id, metadata.data, request.body);
    response.json(result);
  } catch (error: unknown) {
    next(error);
  }
});

runsRouter.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof HttpError) {
    sendError(response, error.statusCode, error.code, error.message);
    return;
  }
  if (typeof error === 'object' && error !== null && 'status' in error && error.status === 413) {
    sendError(response, 413, 'REPLAY_SIZE_INVALID', 'The compressed replay must not exceed 1 MB.');
    return;
  }
  console.error('Run request failed.', error);
  sendError(response, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
});
