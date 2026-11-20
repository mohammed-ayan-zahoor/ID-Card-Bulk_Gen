-- Keep library queries small: summaries contain no complete project JSON or
-- embedded image data. Full documents are fetched only when opened.
alter table public.workspace_records
  add column if not exists name text not null default 'Untitled card',
  add column if not exists orientation text not null default 'horizontal',
  add column if not exists front_background_key text,
  add column if not exists preview_fields jsonb not null default '[]'::jsonb;

update public.workspace_records
set name = coalesce(nullif(document->>'name', ''), 'Untitled card'),
    orientation = case when document->>'orientation' in ('horizontal', 'vertical')
      then document->>'orientation' else 'horizontal' end,
    front_background_key = coalesce(
      nullif(document #>> '{backgroundAssetKeys,front}', ''),
      case when left(coalesce(document #>> '{backgrounds,front}', ''), 10) = 'storage://'
        then substring(document #>> '{backgrounds,front}' from 11)
        else null end
    ),
    preview_fields = coalesce((
      select jsonb_agg(field - 'imageData' - 'imageAssetKey')
      from jsonb_array_elements(coalesce(document #> '{placeholders,front}', '[]'::jsonb)) as field
    ), '[]'::jsonb);

create index if not exists workspace_records_owner_kind_name_idx
  on public.workspace_records (owner_id, kind, name, id);
create index if not exists workspace_records_owner_kind_updated_id_idx
  on public.workspace_records (owner_id, kind, updated_at desc, id desc);
