import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { sendError } from './errors.js';

const CSRF_COOKIE_NAME = 'ghost_racer_csrf';

export function readCookie(request: Request, name: string): string | undefined {
  const cookieHeader = request.header('cookie');
  if (cookieHeader === undefined) {
    return undefined;
  }

  for (const value of cookieHeader.split(';')) {
    const [cookieName, ...cookieValue] = value.trim().split('=');
    if (cookieName === name) {
      return cookieValue.join('=');
    }
  }

  return undefined;
}

export function issueCsrfToken(response: Response): string {
  const token = randomBytes(32).toString('base64url');
  response.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    sameSite: 'strict',
    secure: config.nodeEnv === 'production',
    path: '/',
  });
  return token;
}

export function requireCsrfToken(request: Request, response: Response, next: NextFunction): void {
  const cookieToken = readCookie(request, CSRF_COOKIE_NAME);
  const headerToken = request.header('x-csrf-token');

  if (
    cookieToken === undefined ||
    headerToken === undefined ||
    cookieToken.length !== headerToken.length ||
    !timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))
  ) {
    sendError(response, 403, 'CSRF_INVALID', 'A valid CSRF token is required.');
    return;
  }

  next();
}
