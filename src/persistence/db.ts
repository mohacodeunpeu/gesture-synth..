import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

/**
 * Local persistence (IndexedDB). Nothing ever leaves the device.
 * If IndexedDB is unavailable (some private modes), an in-memory fallback keeps the app working
 * for the session and `persistenceAvailable()` lets the UI warn the user.
 */

export interface StoredSample {
  id: string;
  name: string;
  mime: string;
  size: number;
  duration: number;
  createdAt: number;
  source: 'import' | 'mic';
  data: ArrayBuffer;
}

export interface StoredImage {
  id: string;
  mime: string;
  data: ArrayBuffer;
}

export interface StoredRecording {
  id: string;
  kind: 'video' | 'audio';
  name: string;
  mime: string;
  size: number;
  duration: number;
  createdAt: number;
  blob: Blob;
}

export interface StoredProject {
  id: string;
  name: string;
  updatedAt: number;
  /** serialised Project (JSON-compatible) */
  doc: unknown;
}

interface MohaSchema extends DBSchema {
  samples: { key: string; value: StoredSample };
  images: { key: string; value: StoredImage };
  recordings: { key: string; value: StoredRecording };
  projects: { key: string; value: StoredProject };
  kv: { key: string; value: unknown };
}

type StoreName = 'samples' | 'images' | 'recordings' | 'projects';

export interface Table<T extends { id: string }> {
  get(id: string): Promise<T | undefined>;
  put(value: T): Promise<void>;
  delete(id: string): Promise<void>;
  getAll(): Promise<T[]>;
}

let dbPromise: Promise<IDBPDatabase<MohaSchema> | null> | null = null;
let available = true;
const memory = new Map<string, Map<string, unknown>>();

function db(): Promise<IDBPDatabase<MohaSchema> | null> {
  if (!dbPromise) {
    dbPromise = (async () => {
      if (typeof indexedDB === 'undefined') throw new Error('no indexedDB');
      return openDB<MohaSchema>('moha-motion', 1, {
        upgrade(d) {
          d.createObjectStore('samples', { keyPath: 'id' });
          d.createObjectStore('images', { keyPath: 'id' });
          d.createObjectStore('recordings', { keyPath: 'id' });
          d.createObjectStore('projects', { keyPath: 'id' });
          d.createObjectStore('kv');
        },
        blocked() {
          console.warn('[db] upgrade blocked by another tab');
        },
      });
    })().catch((err) => {
      console.warn('[db] IndexedDB unavailable, using memory only', err);
      available = false;
      return null;
    });
  }
  return dbPromise;
}

function mem(name: string): Map<string, unknown> {
  let m = memory.get(name);
  if (!m) memory.set(name, (m = new Map()));
  return m;
}

function table<T extends { id: string }>(name: StoreName): Table<T> {
  return {
    async get(id) {
      const d = await db();
      if (!d) return mem(name).get(id) as T | undefined;
      return (await d.get(name, id)) as unknown as T | undefined;
    },
    async put(value) {
      const d = await db();
      if (!d) {
        mem(name).set(value.id, value);
        return;
      }
      await d.put(name, value as never);
    },
    async delete(id) {
      const d = await db();
      if (!d) {
        mem(name).delete(id);
        return;
      }
      await d.delete(name, id);
    },
    async getAll() {
      const d = await db();
      if (!d) return [...mem(name).values()] as T[];
      return (await d.getAll(name)) as unknown as T[];
    },
  };
}

export const samplesTable = table<StoredSample>('samples');
export const imagesTable = table<StoredImage>('images');
export const recordingsTable = table<StoredRecording>('recordings');
export const projectsTable = table<StoredProject>('projects');

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const d = await db();
  if (!d) return mem('kv').get(key) as T | undefined;
  return (await d.get('kv', key)) as T | undefined;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const d = await db();
  if (!d) {
    mem('kv').set(key, value);
    return;
  }
  await d.put('kv', value, key);
}

/** Resolves once the database has been opened (or the fallback chosen). */
export async function initPersistence(): Promise<boolean> {
  await db();
  if (available && typeof navigator !== 'undefined' && navigator.storage?.persist) {
    // ask the browser not to evict our data under storage pressure (best effort)
    void navigator.storage.persist().catch(() => false);
  }
  return available;
}

export function persistenceAvailable(): boolean {
  return available;
}
