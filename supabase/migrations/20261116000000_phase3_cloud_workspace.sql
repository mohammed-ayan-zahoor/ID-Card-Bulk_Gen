-- User-owned workspace documents. Run after configuring Clerk as a Supabase
-- Third-party Auth provider in the Supabase dashboard.
create table if not exists public.workspace_records (
  id text primary key,
  owner_id text not null,
  kind text not null check (kind in ('project', 'layout')),
  document jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists workspace_records_owner_kind_updated_idx
  on public.workspace_records (owner_id, kind, updated_at desc);

alter table public.workspace_records enable row level security;
revoke all on public.workspace_records from anon;
grant select, insert, update, delete on public.workspace_records to authenticated;

-- NOTE: auth.uid() returns null here because we use Clerk as a third-party
-- JWT provider, not Supabase native auth. The Clerk user ID lives in the
-- JWT 'sub' claim. Use (select auth.jwt()->>'sub') everywhere, not auth.uid().
-- See: https://supabase.com/docs/guides/auth/third-party/clerk

drop policy if exists "Workspace owners can read their records" on public.workspace_records;
create policy "Workspace owners can read their records"
  on public.workspace_records for select to authenticated
  using (owner_id = (select auth.jwt()->>'sub'));

drop policy if exists "Workspace owners can create their records" on public.workspace_records;
create policy "Workspace owners can create their records"
  on public.workspace_records for insert to authenticated
  with check (owner_id = (select auth.jwt()->>'sub'));

drop policy if exists "Workspace owners can update their records" on public.workspace_records;
create policy "Workspace owners can update their records"
  on public.workspace_records for update to authenticated
  using (owner_id = (select auth.jwt()->>'sub'))
  with check (owner_id = (select auth.jwt()->>'sub'));

drop policy if exists "Workspace owners can delete their records" on public.workspace_records;
create policy "Workspace owners can delete their records"
  on public.workspace_records for delete to authenticated
  using (owner_id = (select auth.jwt()->>'sub'));

-- Private buckets for user-owned uploads and generated previews. Object paths
-- must begin with the Clerk user ID: <clerk-sub>/<file-name>.
insert into storage.buckets (id, name, public)
values
  ('workspace-projects', 'workspace-projects', false),
  ('workspace-layouts', 'workspace-layouts', false),
  ('workspace-previews', 'workspace-previews', false),
  ('workspace-assets', 'workspace-assets', false)
on conflict (id) do update set public = false;

drop policy if exists "Workspace owners can read their files" on storage.objects;
create policy "Workspace owners can read their files"
  on storage.objects for select to authenticated
  using (
    bucket_id in ('workspace-projects', 'workspace-layouts', 'workspace-previews', 'workspace-assets')
    and (storage.foldername(name))[1] = (select auth.jwt()->>'sub')
  );

drop policy if exists "Workspace owners can upload their files" on storage.objects;
create policy "Workspace owners can upload their files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id in ('workspace-projects', 'workspace-layouts', 'workspace-previews', 'workspace-assets')
    and (storage.foldername(name))[1] = (select auth.jwt()->>'sub')
  );

drop policy if exists "Workspace owners can update their files" on storage.objects;
create policy "Workspace owners can update their files"
  on storage.objects for update to authenticated
  using (
    bucket_id in ('workspace-projects', 'workspace-layouts', 'workspace-previews', 'workspace-assets')
    and (storage.foldername(name))[1] = (select auth.jwt()->>'sub')
  )
  with check (
    bucket_id in ('workspace-projects', 'workspace-layouts', 'workspace-previews', 'workspace-assets')
    and (storage.foldername(name))[1] = (select auth.jwt()->>'sub')
  );

drop policy if exists "Workspace owners can delete their files" on storage.objects;
create policy "Workspace owners can delete their files"
  on storage.objects for delete to authenticated
  using (
    bucket_id in ('workspace-projects', 'workspace-layouts', 'workspace-previews', 'workspace-assets')
    and (storage.foldername(name))[1] = (select auth.jwt()->>'sub')
  );
