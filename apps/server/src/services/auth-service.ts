import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { ObjectId } from 'mongodb';
import type { LoginRequest, PublicUser, RegisterRequest } from '@ghost-racer/contracts';
import {
  deleteSession,
  findActiveSession,
  findUserById,
  findUserByIdentity,
  insertSession,
  insertUser,
  setTutorialCompleted,
  type UserDocument,
} from '../persistence/auth-repository.js';
import { HttpError } from '../http/errors.js';

const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export interface CreatedSession {
  token: string;
  expiresAt: Date;
}

function normalizeIdentity(identity: string): string {
  return identity.trim().toLowerCase();
}

function serializePublicUser(user: UserDocument): PublicUser {
  return {
    id: user._id.toHexString(),
    username: user.username,
    role: user.role,
    tutorialCompleted: user.tutorialCompleted,
    createdAt: user.createdAt.toISOString(),
  };
}

function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function createSession(userId: ObjectId): Promise<CreatedSession> {
  const token = randomBytes(32).toString('base64url');
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + SESSION_LIFETIME_MS);

  await insertSession({
    _id: hashSessionToken(token),
    userId,
    createdAt,
    expiresAt,
  });

  return { token, expiresAt };
}

export async function registerAccount(
  request: RegisterRequest,
): Promise<{ user: PublicUser; session: CreatedSession }> {
  const now = new Date();
  const user: UserDocument = {
    _id: new ObjectId(),
    username: request.username,
    usernameNormalized: normalizeIdentity(request.username),
    emailNormalized: request.email,
    passwordHash: await argon2.hash(request.password, { type: argon2.argon2id }),
    role: 'player',
    tutorialCompleted: false,
    createdAt: now,
  };

  try {
    await insertUser(user);
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
      throw new HttpError(409, 'ACCOUNT_EXISTS', 'That username or email is already registered.');
    }
    throw error;
  }

  return { user: serializePublicUser(user), session: await createSession(user._id) };
}

export async function loginAccount(
  request: LoginRequest,
): Promise<{ user: PublicUser; session: CreatedSession }> {
  const user = await findUserByIdentity(normalizeIdentity(request.identity));
  const validPassword = user !== null && (await argon2.verify(user.passwordHash, request.password));

  if (!validPassword || user === null) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid username, email, or password.');
  }

  return { user: serializePublicUser(user), session: await createSession(user._id) };
}

export async function getAuthenticatedUser(token: string): Promise<PublicUser | null> {
  const session = await findActiveSession(hashSessionToken(token));
  if (session === null) {
    return null;
  }

  const user = await findUserById(session.userId);
  return user === null ? null : serializePublicUser(user);
}

export async function revokeSession(token: string): Promise<void> {
  await deleteSession(hashSessionToken(token));
}

export async function completeUserTutorial(userId: string): Promise<PublicUser | null> {
  if (!/^[a-f\d]{24}$/i.test(userId)) return null;
  const user = await setTutorialCompleted(new ObjectId(userId));
  return user === null ? null : serializePublicUser(user);
}
