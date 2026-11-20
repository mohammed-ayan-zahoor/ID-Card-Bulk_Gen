import { createClient } from '@supabase/supabase-js';
import { makeId } from './types';
import type { CardPlaceholder, LayoutRecord, LayoutSummary, ProjectRecord, ProjectSummary, WorkspacePage, WorkspacePageCursor, WorkspaceRecord } from './types';

const STORAGE_PREFIX = 'storage://';
const LARGE_IMAGE_THRESHOLD = 40_000;
const SIGNED_URL_TTL_SECONDS = 60 * 60;
export const WORKSPACE_PAGE_SIZE = 24;
export type WorkspaceSort = 'edited' | 'name';

export interface CloudWorkspaceDb {
  listProjects(): Promise<ProjectRecord[]>;
  listProjectsPage(cursor: WorkspacePageCursor | null, search: string, sort: WorkspaceSort): Promise<WorkspacePage<ProjectSummary>>;
  getProject(id: string): Promise<ProjectRecord | undefined>;
  listLayouts(): Promise<LayoutRecord[]>;
  listLayoutsPage(cursor: WorkspacePageCursor | null, search: string): Promise<WorkspacePage<LayoutSummary>>;
  getLayout(id: string): Promise<LayoutRecord | undefined>;
  saveProject(record: ProjectRecord): Promise<void>;
  saveLayout(record: LayoutRecord): Promise<void>;
  delete(id: string): Promise<void>;
  migrateImages?(): Promise<{ total: number; migrated: number }>;
}

/** Creates a user-scoped Supabase client. Clerk supplies short-lived session tokens. */
export function createCloudWorkspaceDb(ownerId: string, getToken: () => Promise<string | null>): CloudWorkspaceDb | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return null;

  const supabase = createClient(url, publishableKey, {
    accessToken: getToken,
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // Autosave sees the same data URL until the editor reloads. Remember its
  // uploaded object key so repeated saves don't upload identical bytes again.
  const uploadedSources = new Map<string, { source: string; path: string }>();

  const bucketFor = (kind: WorkspaceRecord['kind']) => kind === 'project' ? 'workspace-projects' : 'workspace-layouts';
  const toStorageRef = (path: string) => `${STORAGE_PREFIX}${path}`;
  const fromStorageRef = (value: string | undefined) => value?.startsWith(STORAGE_PREFIX) ? value.slice(STORAGE_PREFIX.length) : undefined;
  const isLargeImageDataUrl = (value: string) => value.startsWith('data:image/') && value.length >= LARGE_IMAGE_THRESHOLD && !value.startsWith('data:image/svg+xml');

  async function uploadImage(bucket: string, recordId: string, slot: string, dataUrl: string): Promise<{ path: string; uploaded: boolean }> {
    const cacheKey = `${bucket}/${recordId}/${slot}`;
    const cached = uploadedSources.get(cacheKey);
    if (cached?.source === dataUrl) return { path: cached.path, uploaded: false };
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const extension = (blob.type.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
    const safeId = recordId.replace(/[^a-z0-9_-]/gi, '_');
    const path = `${ownerId}/${safeId}/${slot}-${makeId('asset')}.${extension}`;
    const { error } = await supabase.storage.from(bucket).upload(path, blob, { contentType: blob.type, upsert: true, cacheControl: '3600' });
    if (error) throw new Error(`Could not upload project image: ${error.message}`);
    uploadedSources.set(cacheKey, { source: dataUrl, path });
    if (uploadedSources.size > 8) uploadedSources.delete(uploadedSources.keys().next().value!);
    return { path, uploaded: true };
  }

  function collectAssetKeys(record: WorkspaceRecord): string[] {
    const keys = new Set<string>();
    Object.values(record.backgroundAssetKeys || {}).forEach((key) => { if (key) keys.add(key); });
    for (const side of ['front', 'back'] as const) {
      const background = record.backgrounds?.[side];
      const ref = typeof background === 'string' ? fromStorageRef(background) : undefined;
      if (ref) keys.add(ref);
      for (const placeholder of record.placeholders[side] || []) {
        if (placeholder.imageAssetKey) keys.add(placeholder.imageAssetKey);
        const imageRef = typeof placeholder.imageData === 'string' ? fromStorageRef(placeholder.imageData) : undefined;
        if (imageRef) keys.add(imageRef);
      }
    }
    return [...keys];
  }

  async function hydrateRecords<T extends WorkspaceRecord>(records: T[], bucket: string): Promise<T[]> {
    const keys = [...new Set(records.flatMap(collectAssetKeys))];
    const signedByPath = new Map<string, string>();
    for (let offset = 0; offset < keys.length; offset += 100) {
      const batch = keys.slice(offset, offset + 100);
      const { data, error } = await supabase.storage.from(bucket).createSignedUrls(batch, SIGNED_URL_TTL_SECONDS);
      if (error) throw new Error(`Could not load project images: ${error.message}`);
      for (const item of data || []) {
        if (item.path && item.signedUrl) signedByPath.set(item.path, item.signedUrl);
      }
    }
    return records.map((record) => {
      const copy = structuredClone(record);
      const signed = (value: string | undefined, key?: string) => {
        const path = key || fromStorageRef(value);
        return path ? signedByPath.get(path) || value : value;
      };
      if (copy.backgrounds) {
        copy.backgrounds.front = signed(copy.backgrounds.front, copy.backgroundAssetKeys?.front);
        copy.backgrounds.back = signed(copy.backgrounds.back, copy.backgroundAssetKeys?.back);
      }
      for (const side of ['front', 'back'] as const) {
        for (const placeholder of copy.placeholders[side] || []) {
          if (typeof placeholder.imageData === 'string') placeholder.imageData = signed(placeholder.imageData, placeholder.imageAssetKey);
        }
      }
      return copy;
    });
  }

  const filterValue = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

  async function listPage(kind: WorkspaceRecord['kind'], cursor: WorkspacePageCursor | null, search: string, sort: WorkspaceSort = 'edited') {
    let request = supabase
      .from('workspace_records')
      .select('id,kind,name,orientation,created_at,updated_at,front_background_key,preview_fields')
      .eq('owner_id', ownerId)
      .eq('kind', kind);
    const normalizedSearch = search.trim();
    if (normalizedSearch) request = request.ilike('name', `%${normalizedSearch}%`);
    if (sort === 'name') {
      request = request.order('name', { ascending: true }).order('id', { ascending: true });
      if (cursor) {
        const value = filterValue(cursor.value);
        const id = filterValue(cursor.id);
        request = request.or(`name.gt.${value},and(name.eq.${value},id.gt.${id})`);
      }
    } else {
      request = request.order('updated_at', { ascending: false }).order('id', { ascending: false });
      if (cursor) request = request.or(`updated_at.lt.${cursor.value},and(updated_at.eq.${cursor.value},id.lt.${filterValue(cursor.id)})`);
    }
    const { data, error } = await request.limit(WORKSPACE_PAGE_SIZE + 1);
    if (error) throw new Error(`Could not load cloud ${kind}s: ${error.message}`);
    const rows = data ?? [];
    const hasMore = rows.length > WORKSPACE_PAGE_SIZE;
    const pageRows = rows.slice(0, WORKSPACE_PAGE_SIZE);
    const assetKeys = [...new Set(pageRows.map((row) => row.front_background_key).filter((key): key is string => Boolean(key)))];
    const signedByPath = new Map<string, string>();
    for (let offset = 0; offset < assetKeys.length; offset += 100) {
      const { data: signedRows, error: signedError } = await supabase.storage.from(bucketFor(kind)).createSignedUrls(assetKeys.slice(offset, offset + 100), SIGNED_URL_TTL_SECONDS);
      if (signedError) throw new Error(`Could not load workspace previews: ${signedError.message}`);
      for (const item of signedRows || []) if (item.path && item.signedUrl) signedByPath.set(item.path, item.signedUrl);
    }
    const items = pageRows.map((row) => ({
      kind,
      id: row.id,
      name: row.name,
      orientation: row.orientation,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      frontBackground: row.front_background_key ? signedByPath.get(row.front_background_key) : undefined,
      previewFields: (row.preview_fields || []) as CardPlaceholder[],
    }));
    const last = pageRows.at(-1);
    const nextCursor = hasMore && last
      ? { value: sort === 'name' ? last.name : last.updated_at, id: last.id }
      : null;
    return { items, hasMore, nextCursor };
  }

  async function save(record: WorkspaceRecord): Promise<void> {
    const bucket = bucketFor(record.kind);
    const document = structuredClone(record) as WorkspaceRecord;
    const newlyUploaded: string[] = [];
    const uploadOrKeep = async (value: string | undefined, key?: string, slot = 'image') => {
      if (!value) return { value, key: undefined };
      const storageRef = fromStorageRef(value);
      if (storageRef) return { value: toStorageRef(storageRef), key: storageRef };
      if (isLargeImageDataUrl(value)) {
        const { path, uploaded } = await uploadImage(bucket, record.id, slot, value);
        if (uploaded) newlyUploaded.push(path);
        return { value: toStorageRef(path), key: path };
      }
      if (/^https?:\/\//i.test(value) && key) return { value: toStorageRef(key), key };
      return { value, key: undefined };
    };

    const backgroundAssetKeys: { front?: string; back?: string } = {};
    document.backgroundAssetKeys = backgroundAssetKeys;
    try {
      await Promise.all((['front', 'back'] as const).map(async (side) => {
        const result = await uploadOrKeep(document.backgrounds?.[side], record.backgroundAssetKeys?.[side], `background-${side}`);
        if (document.backgrounds) document.backgrounds[side] = result.value;
        if (result.key) backgroundAssetKeys[side] = result.key;
      }));
      await Promise.all((['front', 'back'] as const).flatMap((side) =>
        (document.placeholders[side] || []).map(async (placeholder, index) => {
          if (typeof placeholder.imageData !== 'string') return;
          const result = await uploadOrKeep(placeholder.imageData, placeholder.imageAssetKey, `photo-${side}-${index}`);
          placeholder.imageData = result.value;
          placeholder.imageAssetKey = result.key;
        }),
      ));

      const { error } = await supabase.from('workspace_records').upsert({
        id: document.id,
        owner_id: ownerId,
        kind: document.kind,
        name: document.name,
        orientation: document.orientation,
        front_background_key: document.backgroundAssetKeys?.front || null,
        preview_fields: createPreviewFields(document.placeholders.front),
        document,
        created_at: document.createdAt,
        updated_at: document.updatedAt,
      });
      if (error) throw new Error(`Could not save to cloud: ${error.message}`);
    } catch (error) {
      if (newlyUploaded.length) {
        await supabase.storage.from(bucket).remove(newlyUploaded);
        for (const [cacheKey, value] of uploadedSources) {
          if (newlyUploaded.includes(value.path)) uploadedSources.delete(cacheKey);
        }
      }
      throw error;
    }
  }

  function createPreviewFields(fields: CardPlaceholder[]): CardPlaceholder[] {
    return fields.slice(0, 24).map((field) => ({
      id: field.id,
      type: field.type,
      key: field.key,
      staticText: field.staticText,
      x: field.x,
      y: field.y,
      width: field.width,
      height: field.height,
      fontSize: field.fontSize,
      fontWeight: field.fontWeight,
      color: field.color,
      fill: field.fill,
      stroke: field.stroke,
    }));
  }

  return {
    listProjects: async () => {
      const { data, error } = await supabase.from('workspace_records').select('document')
        .eq('owner_id', ownerId).eq('kind', 'project').order('updated_at', { ascending: false });
      if (error) throw new Error(`Could not load cloud projects: ${error.message}`);
      return await hydrateRecords((data || []).map((r) => r.document as ProjectRecord), 'workspace-projects');
    },
    listProjectsPage: (cursor, search, sort) => listPage('project', cursor, search, sort) as Promise<WorkspacePage<ProjectSummary>>,
    getProject: async (id) => {
      const { data, error } = await supabase.from('workspace_records').select('document')
        .eq('owner_id', ownerId).eq('kind', 'project').eq('id', id).maybeSingle();
      if (error) throw new Error(`Could not open cloud project: ${error.message}`);
      if (!data?.document) return undefined;
      return (await hydrateRecords([data.document as ProjectRecord], 'workspace-projects'))[0];
    },
    listLayouts: async () => {
      const { data, error } = await supabase.from('workspace_records').select('document')
        .eq('owner_id', ownerId).eq('kind', 'layout').order('updated_at', { ascending: false });
      if (error) throw new Error(`Could not load cloud layouts: ${error.message}`);
      return await hydrateRecords((data || []).map((r) => r.document as LayoutRecord), 'workspace-layouts');
    },
    listLayoutsPage: (cursor, search) => listPage('layout', cursor, search) as Promise<WorkspacePage<LayoutSummary>>,
    getLayout: async (id) => {
      const { data, error } = await supabase.from('workspace_records').select('document')
        .eq('owner_id', ownerId).eq('kind', 'layout').eq('id', id).maybeSingle();
      if (error) throw new Error(`Could not open cloud layout: ${error.message}`);
      if (!data?.document) return undefined;
      return (await hydrateRecords([data.document as LayoutRecord], 'workspace-layouts'))[0];
    },
    saveProject: (record) => save(record),
    saveLayout: (record) => save(record),
    delete: async (id) => {
      const { data: row, error: readError } = await supabase.from('workspace_records').select('document')
        .eq('owner_id', ownerId).eq('id', id).maybeSingle();
      if (readError) throw new Error(`Could not inspect cloud project assets: ${readError.message}`);
      const { error } = await supabase.from('workspace_records').delete().eq('id', id);
      if (error) throw new Error(`Could not delete cloud project: ${error.message}`);
      const record = row?.document as WorkspaceRecord | undefined;
      // Asset deletion is intentionally deferred: duplicate projects/layouts
      // can share an object key. A ref-counted cleanup pass is needed first.
      if (record) {
        const prefix = `${bucketFor(record.kind)}/${record.id}/`;
        for (const key of uploadedSources.keys()) if (key.startsWith(prefix)) uploadedSources.delete(key);
      }
    },
    migrateImages: async () => {
      const { data, error } = await supabase.from('workspace_records').select('id, kind, document').eq('owner_id', ownerId);
      if (error || !data) return { total: 0, migrated: 0 };
      let migrated = 0;
      for (const row of data) {
        const doc = row.document as WorkspaceRecord | undefined;
        if (!doc) continue;
        let hasLargeImages = false;
        if (doc.backgrounds?.front && isLargeImageDataUrl(doc.backgrounds.front)) hasLargeImages = true;
        if (doc.backgrounds?.back && isLargeImageDataUrl(doc.backgrounds.back)) hasLargeImages = true;
        for (const side of ['front', 'back'] as const) {
          for (const p of doc.placeholders[side] || []) {
            if (typeof p.imageData === 'string' && isLargeImageDataUrl(p.imageData)) hasLargeImages = true;
          }
        }
        if (hasLargeImages) {
          try {
            await save(doc);
            migrated += 1;
          } catch (e) {
            console.warn(`Could not migrate images for record ${row.id}:`, e);
          }
        }
      }
      return { total: data.length, migrated };
    },
  };
}
