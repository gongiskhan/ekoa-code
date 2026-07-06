/**
 * The Firestore (Mongo-compat) client (ch04 §4.1, P-05). One `mongodb` driver connection
 * for both app-data and every platform domain store; single database. Fail-fast on a bad
 * connection string (ch09 §9.7 storage-backend gate). Dev/tests point the SAME driver at
 * an in-memory server (`mongodb-memory-server`); production points it at Firestore Enterprise.
 */
import { MongoClient, type Db } from 'mongodb';

let client: MongoClient | undefined;
let db: Db | undefined;

/** Connect (fail-fast). `uri` overrides MONGODB_URI (tests inject the memory-server uri). */
export async function connectMongo(uri?: string, dbName = 'ekoa'): Promise<Db> {
  const target = uri ?? process.env.MONGODB_URI;
  if (!target) throw new Error('MONGODB_URI is not set (storage-backend boot gate, ch09 §9.7)');
  client = new MongoClient(target, { serverSelectionTimeoutMS: 5000 });
  await client.connect(); // throws on a bad connection string / unreachable server → fail-fast
  db = client.db(dbName);
  return db;
}

export function getDb(): Db {
  if (!db) throw new Error('Mongo not connected — call connectMongo() at boot');
  return db;
}

export async function closeMongo(): Promise<void> {
  await client?.close();
  client = undefined;
  db = undefined;
}
