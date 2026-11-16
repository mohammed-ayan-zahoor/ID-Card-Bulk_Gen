import type { CardDocument, LayoutRecord, ProjectRecord, WorkspaceRecord } from './types';

const DB_NAME = 'quantech-id-studio';
const DB_VERSION = 2;
const RECORDS = 'records';
const META = 'meta';
const ASSETS = 'assets';
const IMPORT_MARKER = 'legacy-import-v1';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RECORDS)) {
        const store = db.createObjectStore(RECORDS, { keyPath: 'id' });
        store.createIndex('kind', 'kind', { unique: false });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(ASSETS)) db.createObjectStore(ASSETS, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open local project storage.'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Local storage request failed.'));
  });
}

async function list(kind: WorkspaceRecord['kind']): Promise<WorkspaceRecord[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(RECORDS, 'readonly');
    const rows = await requestResult(tx.objectStore(RECORDS).index('kind').getAll(kind)) as WorkspaceRecord[];
    return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } finally { db.close(); }
}

async function save(record: WorkspaceRecord): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(RECORDS, 'readwrite');
    tx.objectStore(RECORDS).put(record);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Could not save your project.'));
      tx.onabort = () => reject(tx.error ?? new Error('Project save was cancelled.'));
    });
  } finally { db.close(); }
}

async function remove(id: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(RECORDS, 'readwrite');
    tx.objectStore(RECORDS).delete(id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Could not delete this item.'));
    });
  } finally { db.close(); }
}

async function saveAsset(asset: { id: string; name: string; mimeType: string; dataUrl: string; updatedAt: string }): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(ASSETS, 'readwrite');
    tx.objectStore(ASSETS).put(asset);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Could not save this asset.'));
      tx.onabort = () => reject(tx.error ?? new Error('Asset save was cancelled.'));
    });
  } finally { db.close(); }
}

async function listAssets(): Promise<Array<{ id: string; name: string; mimeType: string; dataUrl: string; updatedAt: string }>> {
  const db = await openDb();
  try { return await requestResult(db.transaction(ASSETS, 'readonly').objectStore(ASSETS).getAll()); }
  finally { db.close(); }
}

function safeJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch { return fallback; }
}

function readLegacyJson<T>(key: string, fallback: T): T {
  const source = localStorage.getItem(key);
  if (source === null) return fallback;
  try { return JSON.parse(source) as T; }
  catch { throw new Error(`Legacy workspace data in “${key}” is unreadable. The original data was left untouched.`); }
}

function normalizeProject(value: Partial<CardDocument>, index: number): ProjectRecord | null {
  if (!value || !value.orientation || !value.placeholders) return null;
  const now = new Date().toISOString();
  return {
    ...value,
    schemaVersion: 1,
    kind: 'project',
    id: value.id || `legacy-project-${index}`,
    name: value.name || `Untitled card ${index + 1}`,
    orientation: value.orientation,
    backgrounds: value.backgrounds || {},
    placeholders: {
      front: value.placeholders.front || [],
      back: value.placeholders.back || [],
    },
    createdAt: value.createdAt || now,
    updatedAt: value.updatedAt || value.createdAt || now,
  } as ProjectRecord;
}

function normalizeLayout(name: string, value: Partial<LayoutRecord>): LayoutRecord | null {
  if (!value || !value.orientation || !value.placeholders) return null;
  const now = new Date().toISOString();
  const id = `legacy-layout-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return {
    ...value,
    schemaVersion: 1,
    kind: 'layout',
    id,
    name: value.name || name,
    orientation: value.orientation,
    placeholders: { front: value.placeholders.front || [], back: value.placeholders.back || [] },
    createdAt: value.createdAt || value.dateCreated || value.updatedAt || now,
    updatedAt: value.updatedAt || value.dateCreated || value.createdAt || now,
  } as LayoutRecord;
}

export async function migrateLegacyData(): Promise<{ projects: number; layouts: number }> {
  const db = await openDb();
  try {
    const markerTx = db.transaction(META, 'readonly');
    const marker = await requestResult(markerTx.objectStore(META).get(IMPORT_MARKER));
    if (marker) return { projects: 0, layouts: 0 };

    const projects = readLegacyJson<Partial<CardDocument>[]>('quantech_saved_docs', []);
    const layouts = readLegacyJson<Record<string, Partial<LayoutRecord>>>('idCardLayouts', {});
    const oldLayouts = readLegacyJson<Record<string, Partial<LayoutRecord>>>('card_generator_layouts', {});
    const tx = db.transaction([RECORDS, META], 'readwrite');
    const store = tx.objectStore(RECORDS);
    let projectCount = 0;
    let layoutCount = 0;
    projects.forEach((item, index) => {
      const record = normalizeProject(item, index);
      if (record) { store.put(record); projectCount += 1; }
    });
    for (const [name, value] of Object.entries({ ...oldLayouts, ...layouts })) {
      const record = normalizeLayout(name, value);
      if (record) { store.put(record); layoutCount += 1; }
    }
    tx.objectStore(META).put({ key: IMPORT_MARKER, importedAt: new Date().toISOString() });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Could not migrate local projects.'));
      tx.onabort = () => reject(tx.error ?? new Error('Local project migration was cancelled.'));
    });
    return { projects: projectCount, layouts: layoutCount };
  } finally { db.close(); }
}

export async function importLegacyLayouts(): Promise<number> {
  const legacy = safeJson<Record<string, Partial<LayoutRecord>>>('idCardLayouts', {});
  const existing = await list('layout') as LayoutRecord[];
  const byId = new Map(existing.map((item) => [item.id, item]));
  let count = 0;
  for (const [name, value] of Object.entries(legacy)) {
    const record = normalizeLayout(name, value);
    if (!record) continue;
    const current = byId.get(record.id);
    const sourceTime = Date.parse(value.dateCreated || value.updatedAt || value.createdAt || '1970-01-01');
    if (!current || sourceTime > Date.parse(current.updatedAt)) {
      await save(record);
      byId.set(record.id, record);
      count += 1;
    }
  }
  return count;
}

export const workspaceDb = {
  listProjects: () => list('project') as Promise<ProjectRecord[]>,
  listLayouts: () => list('layout') as Promise<LayoutRecord[]>,
  saveProject: (record: ProjectRecord) => save(record),
  saveLayout: (record: LayoutRecord) => save(record),
  delete: remove,
  saveAsset,
  listAssets,
};
