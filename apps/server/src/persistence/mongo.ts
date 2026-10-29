import { Db, MongoClient } from 'mongodb';
import { config } from '../config.js';

let client: MongoClient | undefined;
let database: Db | undefined;

export async function connectToMongo(): Promise<Db> {
  if (database !== undefined) {
    return database;
  }

  const newClient = new MongoClient(config.mongoUri, {
    serverSelectionTimeoutMS: 5_000,
  });

  try {
    await newClient.connect();
  } catch (error: unknown) {
    await newClient.close();
    throw error;
  }
  client = newClient;
  database = newClient.db();
  return database;
}

export async function isMongoConnected(): Promise<boolean> {
  if (database === undefined) return false;
  try {
    await database.command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

export async function closeMongoConnection(): Promise<void> {
  if (client !== undefined) {
    await client.close();
  }

  client = undefined;
  database = undefined;
}
