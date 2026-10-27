import { ObjectId, type Collection } from 'mongodb';
import type { UserRole } from '@ghost-racer/contracts';
import { connectToMongo } from './mongo.js';

export interface UserDocument {
  _id: ObjectId;
  username: string;
  usernameNormalized: string;
  emailNormalized: string;
  passwordHash: string;
  role: UserRole;
  tutorialCompleted: boolean;
  createdAt: Date;
}

export interface SessionDocument {
  _id: string;
  userId: ObjectId;
  createdAt: Date;
  expiresAt: Date;
}

async function users(): Promise<Collection<UserDocument>> {
  return (await connectToMongo()).collection<UserDocument>('users');
}

async function sessions(): Promise<Collection<SessionDocument>> {
  return (await connectToMongo()).collection<SessionDocument>('sessions');
}

export async function ensureAuthenticationIndexes(): Promise<void> {
  const [userCollection, sessionCollection] = await Promise.all([users(), sessions()]);

  await Promise.all([
    userCollection.createIndex({ usernameNormalized: 1 }, { unique: true, name: 'unique_username' }),
    userCollection.createIndex({ emailNormalized: 1 }, { unique: true, name: 'unique_email' }),
    sessionCollection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'session_expiry' }),
  ]);
}

export async function insertUser(user: UserDocument): Promise<void> {
  await (await users()).insertOne(user);
}

export async function findUserByIdentity(identity: string): Promise<UserDocument | null> {
  return (await users()).findOne({
    $or: [{ usernameNormalized: identity }, { emailNormalized: identity }],
  });
}

export async function findUserById(id: ObjectId): Promise<UserDocument | null> {
  return (await users()).findOne({ _id: id });
}

export async function setTutorialCompleted(id: ObjectId): Promise<UserDocument | null> {
  await (await users()).updateOne({ _id: id }, { $set: { tutorialCompleted: true } });
  return findUserById(id);
}

export async function insertSession(session: SessionDocument): Promise<void> {
  await (await sessions()).insertOne(session);
}

export async function findActiveSession(tokenHash: string): Promise<SessionDocument | null> {
  return (await sessions()).findOne({ _id: tokenHash, expiresAt: { $gt: new Date() } });
}

export async function deleteSession(tokenHash: string): Promise<void> {
  await (await sessions()).deleteOne({ _id: tokenHash });
}
