import { Router, type NextFunction, type Request, type Response } from 'express';
import { LeaderboardParamsSchema } from '@ghost-racer/contracts';
import { getAuthenticatedUser } from '../services/auth-service.js';
import { getSoloLeaderboard } from '../services/leaderboard-service.js';
import { readCookie } from './csrf.js';
import { HttpError, sendError } from './errors.js';

const SESSION_COOKIE_NAME = 'ghost_racer_session';
export const leaderboardRouter = Router();

leaderboardRouter.get('/:trackId/:carId', async (request, response, next) => {
  try {
    const sessionToken = readCookie(request, SESSION_COOKIE_NAME);
    const user = sessionToken === undefined ? null : await getAuthenticatedUser(sessionToken);
    if (user === null) {
      sendError(response, 401, 'UNAUTHORIZED', 'Authentication is required.');
      return;
    }
    const params = LeaderboardParamsSchema.safeParse(request.params);
    if (!params.success) {
      sendError(response, 400, 'VALIDATION_ERROR', 'Leaderboard track and car are invalid.');
      return;
    }
    response.setHeader('Cache-Control', 'private, no-store');
    response.json(await getSoloLeaderboard(params.data.trackId, params.data.carId));
  } catch (error: unknown) {
    next(error);
  }
});

leaderboardRouter.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof HttpError) {
    sendError(response, error.statusCode, error.code, error.message);
    return;
  }
  console.error('Leaderboard request failed.', error);
  sendError(response, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
});
