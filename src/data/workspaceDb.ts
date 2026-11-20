import { layoutToSummary, projectToSummary } from './types';
import type { CardDocument, LayoutRecord, LayoutSummary, ProjectRecord, ProjectSummary, WorkspacePage, WorkspacePageCursor, WorkspaceRecord, WorkspaceSort } from './types';

const DB_NAME = 'quantech-id-studio';
const DB_VERSION = 2;
const RECORDS = 'records';
const META = 'meta';
const ASSETS = 'assets';
const IMPORT_MARKER = 'legacy-import-v1';
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
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
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    request.onerror = () => { dbPromise = null; reject(request.error ?? new Error('Could not open local project storage.')); };
    request.onblocked = () => { dbPromise = null; reject(new Error('Local project storage is busy in another tab. Close other app tabs and retry.')); };
  });
  return dbPromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Local storage request failed.'));
  });
}

async function list(kind: WorkspaceRecord['kind']): Promise<WorkspaceRecord[]> {
  const db = await openDb();
  const tx = db.transaction(RECORDS, 'readonly');
  const rows = await requestResult(tx.objectStore(RECORDS).index('kind').getAll(kind)) as WorkspaceRecord[];
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function getRecord(id: string): Promise<WorkspaceRecord | undefined> {
  const db = await openDb();
  return await requestResult(db.transaction(RECORDS, 'readonly').objectStore(RECORDS).get(id)) as WorkspaceRecord | undefined;
}

async function save(record: WorkspaceRecord): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(RECORDS, 'readwrite');
  tx.objectStore(RECORDS).put(record);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Could not save your project.'));
    tx.onabort = () => reject(tx.error ?? new Error('Project save was cancelled.'));
  });
}

async function remove(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(RECORDS, 'readwrite');
  tx.objectStore(RECORDS).delete(id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Could not delete this item.'));
    tx.onabort = () => reject(tx.error ?? new Error('Could not delete this item.'));
  });
}

async function saveAsset(asset: { id: string; name: string; mimeType: string; dataUrl: string; updatedAt: string }): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(ASSETS, 'readwrite');
  tx.objectStore(ASSETS).put(asset);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Could not save this asset.'));
    tx.onabort = () => reject(tx.error ?? new Error('Asset save was cancelled.'));
  });
}

async function listAssets(): Promise<Array<{ id: string; name: string; mimeType: string; dataUrl: string; updatedAt: string }>> {
  const db = await openDb();
  return await requestResult(db.transaction(ASSETS, 'readonly').objectStore(ASSETS).getAll());
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

async function listPage<T extends ProjectSummary | LayoutSummary>(
  kind: WorkspaceRecord['kind'],
  cursor: WorkspacePageCursor | null,
  search: string,
  sort: WorkspaceSort = 'edited'
): Promise<WorkspacePage<T>> {
  const all = await list(kind);
  let filtered = all;
  const q = search.trim().toLowerCase();
  if (q) {
    filtered = filtered.filter((item) => item.name.toLowerCase().includes(q));
  }
  if (sort === 'name') {
    filtered = filtered.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  } else {
    filtered = filtered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
  }
  let startIndex = 0;
  if (cursor) {
    const idx = filtered.findIndex((item) => item.id === cursor.id);
    if (idx >= 0) startIndex = idx + 1;
  }
  const pageItems = filtered.slice(startIndex, startIndex + 24);
  const hasMore = startIndex + 24 < filtered.length;
  const last = pageItems.at(-1);
  const nextCursor = hasMore && last ? { value: sort === 'name' ? last.name : last.updatedAt, id: last.id } : null;

  const items = pageItems.map((record) => {
    if (record.kind === 'project') return projectToSummary(record as ProjectRecord) as T;
    return layoutToSummary(record as LayoutRecord) as T;
  });

  return { items, hasMore, nextCursor };
}

export const workspaceDb = {
  listProjects: () => list('project') as Promise<ProjectRecord[]>,
  listProjectsPage: (cursor: WorkspacePageCursor | null, search: string, sort: WorkspaceSort = 'edited') =>
    listPage<ProjectSummary>('project', cursor, search, sort),
  getProject: async (id: string) => {
    const record = await getRecord(id);
    return record?.kind === 'project' ? record : undefined;
  },
  listLayouts: () => list('layout') as Promise<LayoutRecord[]>,
  listLayoutsPage: (cursor: WorkspacePageCursor | null, search: string) =>
    listPage<LayoutSummary>('layout', cursor, search, 'edited'),
  getLayout: async (id: string) => {
    const record = await getRecord(id);
    return record?.kind === 'layout' ? record : undefined;
  },
  saveProject: (record: ProjectRecord) => save(record),
  saveLayout: (record: LayoutRecord) => save(record),
  delete: remove,
  saveAsset,
  listAssets,
};
