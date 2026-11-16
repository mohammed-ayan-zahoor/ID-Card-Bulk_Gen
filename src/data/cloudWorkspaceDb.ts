import { createClient } from '@supabase/supabase-js';
import type { LayoutRecord, ProjectRecord, WorkspaceRecord } from './types';

export interface CloudWorkspaceDb {
  listProjects(): Promise<ProjectRecord[]>;
  listLayouts(): Promise<LayoutRecord[]>;
  saveProject(record: ProjectRecord): Promise<void>;
  saveLayout(record: LayoutRecord): Promise<void>;
  delete(id: string): Promise<void>;
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

  async function list(kind: WorkspaceRecord['kind']): Promise<WorkspaceRecord[]> {
    const { data, error } = await supabase
      .from('workspace_records')
      .select('document')
      .eq('kind', kind)
      .order('updated_at', { ascending: false });
    if (error) throw new Error(`Could not load cloud ${kind}s: ${error.message}`);
    return (data ?? []).map((row) => row.document as WorkspaceRecord);
  }

  async function save(record: WorkspaceRecord): Promise<void> {
    const { error } = await supabase.from('workspace_records').upsert({
      id: record.id,
      owner_id: ownerId,
      kind: record.kind,
      document: record,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    });
    if (error) throw new Error(`Could not save to cloud: ${error.message}`);
  }

  return {
    listProjects: async () => await list('project') as ProjectRecord[],
    listLayouts: async () => await list('layout') as LayoutRecord[],
    saveProject: (record) => save(record),
    saveLayout: (record) => save(record),
    delete: async (id) => {
      const { error } = await supabase.from('workspace_records').delete().eq('id', id);
      if (error) throw new Error(`Could not delete cloud project: ${error.message}`);
    },
  };
}
