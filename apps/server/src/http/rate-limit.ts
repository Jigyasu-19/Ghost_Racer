import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import { consumeRateLimit } from '../persistence/redis.js';
import { HttpError, sendError } from './errors.js';

export function rateLimitByIp(name: string, limit: number, windowSeconds: number): RequestHandler {
  return (request, response, next) => {
    const ip = request.ip ?? request.socket.remoteAddress ?? 'unknown';
    const ipHash = createHash('sha256').update(ip).digest('hex');
    void consumeRateLimit(`rate-limit:${name}:ip:${ipHash}`, limit, windowSeconds)
      .then((allowed) => {
        if (!allowed) {
          response.setHeader('Retry-After', String(windowSeconds));
          sendError(response, 429, 'RATE_LIMITED', 'Too many requests. Please wait before trying again.');
          return;
        }
        next();
      })
      .catch((error: unknown) => {
        console.error(`${name} rate-limit check failed.`, error);
        next(new HttpError(503, 'RATE_LIMIT_UNAVAILABLE', 'This service is temporarily unavailable.'));
      });
  };
}
