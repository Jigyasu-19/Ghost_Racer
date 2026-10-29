import { Router, type NextFunction, type Request, type Response } from 'express';
import { LoginRequestSchema, RegisterRequestSchema } from '@ghost-racer/contracts';
import { config } from '../config.js';
import { completeUserTutorial, getAuthenticatedUser, loginAccount, registerAccount, revokeSession } from '../services/auth-service.js';
import { issueCsrfToken, readCookie, requireCsrfToken } from './csrf.js';
import { HttpError, sendError } from './errors.js';
import { rateLimitByIp } from './rate-limit.js';

const SESSION_COOKIE_NAME = 'ghost_racer_session';
const SESSION_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const authRouter = Router();

authRouter.get('/csrf', (_request, response) => {
  response.json({ csrfToken: issueCsrfToken(response) });
});

authRouter.post('/register', requireCsrfToken, rateLimitByIp('auth:register', 5, 60 * 60), async (request, response, next) => {
  const parsed = RegisterRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    sendError(response, 400, 'VALIDATION_ERROR', 'Invalid registration request.');
    return;
  }

  try {
    const result = await registerAccount(parsed.data);
    setSessionCookie(response, result.session.token, result.session.expiresAt);
    response.status(201).json({ user: result.user });
  } catch (error: unknown) {
    next(error);
  }
});

authRouter.post('/login', requireCsrfToken, rateLimitByIp('auth:login', 10, 15 * 60), async (request, response, next) => {
  const parsed = LoginRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    sendError(response, 400, 'VALIDATION_ERROR', 'Invalid sign-in request.');
    return;
  }

  try {
    const result = await loginAccount(parsed.data);
    setSessionCookie(response, result.session.token, result.session.expiresAt);
    response.json({ user: result.user });
  } catch (error: unknown) {
    next(error);
  }
});

authRouter.post('/logout', requireCsrfToken, async (request, response, next) => {
  try {
    const token = readCookie(request, SESSION_COOKIE_NAME);
    if (token !== undefined) {
      await revokeSession(token);
    }
    response.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions());
    response.status(204).end();
  } catch (error: unknown) {
    next(error);
  }
});

authRouter.post('/tutorial-complete', requireCsrfToken, async (request, response, next) => {
  try {
    const token = readCookie(request, SESSION_COOKIE_NAME);
    const currentUser = token === undefined ? null : await getAuthenticatedUser(token);
    if (currentUser === null) {
      sendError(response, 401, 'UNAUTHORIZED', 'Authentication is required.');
      return;
    }

    const user = await completeUserTutorial(currentUser.id);
    if (user === null) {
      sendError(response, 404, 'USER_NOT_FOUND', 'The account could not be found.');
      return;
    }
    response.json({ user });
  } catch (error: unknown) {
    next(error);
  }
});

authRouter.get('/me', async (request, response, next) => {
  try {
    const token = readCookie(request, SESSION_COOKIE_NAME);
    const user = token === undefined ? null : await getAuthenticatedUser(token);
    if (user === null) {
      sendError(response, 401, 'UNAUTHORIZED', 'Authentication is required.');
      return;
    }
    response.json({ user });
  } catch (error: unknown) {
    next(error);
  }
});

authRouter.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof HttpError) {
    sendError(response, error.statusCode, error.code, error.message);
    return;
  }

  console.error('Authentication request failed.', error);
  sendError(response, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
});

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: config.nodeEnv === 'production',
    path: '/',
  };
}

function setSessionCookie(response: Response, token: string, expiresAt: Date): void {
  response.cookie(SESSION_COOKIE_NAME, token, {
    ...sessionCookieOptions(),
    expires: expiresAt,
    maxAge: SESSION_COOKIE_MAX_AGE_MS,
  });
}
