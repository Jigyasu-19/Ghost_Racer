import { Router, type NextFunction, type Request, type Response } from 'express';
import { CreateTournamentRequestSchema } from '@ghost-racer/contracts';
import { getAuthenticatedUser } from '../services/auth-service.js';
import { createTournament, getAdminTournamentHistory, getTournamentStatus } from '../services/tournament-service.js';
import { readCookie, requireCsrfToken } from './csrf.js';
import { HttpError, sendError } from './errors.js';

const SESSION_COOKIE_NAME = 'ghost_racer_session';
export const tournamentsRouter = Router();

tournamentsRouter.post('/', requireCsrfToken, async (request, response, next) => {
  try {
    const token = readCookie(request, SESSION_COOKIE_NAME);
    const user = token === undefined ? null : await getAuthenticatedUser(token);
    if (user === null) {
      sendError(response, 401, 'UNAUTHORIZED', 'Authentication is required.');
      return;
    }
    if (user.role !== 'admin') {
      sendError(response, 403, 'FORBIDDEN', 'Administrator access is required.');
      return;
    }
    const parsed = CreateTournamentRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      sendError(response, 400, 'VALIDATION_ERROR', 'A valid tournament track is required.');
      return;
    }
    const tournament = await createTournament(user.id, user.username, parsed.data.trackId);
    response.status(201).json({ tournament });
  } catch (error: unknown) {
    next(error);
  }
});

tournamentsRouter.get('/', async (request, response, next) => {
  try {
    const token = readCookie(request, SESSION_COOKIE_NAME);
    const user = token === undefined ? null : await getAuthenticatedUser(token);
    if (user === null) {
      sendError(response, 401, 'UNAUTHORIZED', 'Authentication is required.');
      return;
    }
    if (user.role !== 'admin') {
      sendError(response, 403, 'FORBIDDEN', 'Administrator access is required.');
      return;
    }
    response.json(await getAdminTournamentHistory(user.id));
  } catch (error: unknown) {
    next(error);
  }
});

tournamentsRouter.get('/:id', async (request, response, next) => {
  try {
    const token = readCookie(request, SESSION_COOKIE_NAME);
    const user = token === undefined ? null : await getAuthenticatedUser(token);
    if (user === null) {
      sendError(response, 401, 'UNAUTHORIZED', 'Authentication is required.');
      return;
    }
    const tournament = await getTournamentStatus(request.params.id ?? '', user.id);
    response.json({ tournament });
  } catch (error: unknown) {
    next(error);
  }
});

tournamentsRouter.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof HttpError) {
    sendError(response, error.statusCode, error.code, error.message);
    return;
  }
  console.error('Tournament request failed.', error);
  sendError(response, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
});
