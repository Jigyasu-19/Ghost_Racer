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

  await newClient.connect();
  client = newClient;
  database = newClient.db();
  return database;
}

export function isMongoConnected(): boolean {
  return database !== undefined;
}

export async function closeMongoConnection(): Promise<void> {
  if (client !== undefined) {
    await client.close();
  }

  client = undefined;
  database = undefined;
}
