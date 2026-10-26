-- Run in a dedicated Supabase project, before enabling the frontend feature flag.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table private.paper_aisle_allowed_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table private.paper_aisle_allowed_users enable row level security;
revoke all on private.paper_aisle_allowed_users from public, anon, authenticated;

create function public.paper_aisle_sync_access() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.paper_aisle_allowed_users where user_id = (select auth.uid()));
$$;
revoke all on function public.paper_aisle_sync_access() from public, anon;
grant execute on function public.paper_aisle_sync_access() to authenticated;

create function public.paper_aisle_valid_record(value jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
begin
  if value is null or jsonb_typeof(value) <> 'object' then return false; end if;
  if exists (select 1 from jsonb_object_keys(value) k where k not in ('favorite','favoritedAt','readingStatus','note','tags')) then return false; end if;
  if value ? 'favorite' and jsonb_typeof(value->'favorite') <> 'boolean' then return false; end if;
  if value ? 'favoritedAt' then
    if jsonb_typeof(value->'favoritedAt') <> 'number' then return false; end if;
    if (value->>'favoritedAt')::numeric < 0 then return false; end if;
  end if;
  if value ? 'readingStatus' and (jsonb_typeof(value->'readingStatus') <> 'string' or value->>'readingStatus' not in ('unread','skimmed','reading','read')) then return false; end if;
  if value ? 'note' and jsonb_typeof(value->'note') <> 'string' then return false; end if;
  if value ? 'tags' then
    if jsonb_typeof(value->'tags') <> 'array' then return false; end if;
    if exists (select 1 from jsonb_array_elements(value->'tags') tag where jsonb_typeof(tag) <> 'string') then return false; end if;
  end if;
  return true;
end;
$$;
revoke all on function public.paper_aisle_valid_record(jsonb) from public, anon, authenticated;

create table public.paper_reading_records (
  user_id uuid not null references auth.users(id) on delete cascade,
  dataset_id text not null check (length(dataset_id) between 1 and 200),
  paper_id text not null check (length(paper_id) between 1 and 500 and paper_id not in ('__proto__','constructor','prototype')),
  data jsonb not null check (public.paper_aisle_valid_record(data)),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key(user_id, dataset_id, paper_id)
);
alter table public.paper_reading_records enable row level security;
revoke all on public.paper_reading_records from public, anon, authenticated;
grant select on public.paper_reading_records to authenticated;
create policy own_allowed_read on public.paper_reading_records for select to authenticated
  using ((select auth.uid()) = user_id and (select public.paper_aisle_sync_access()));

-- All writes go through this atomic compare-and-swap RPC. Caller cannot select a user_id.
-- Row locks and ON CONFLICT protect both simultaneous first writes and later edits.
create function public.paper_aisle_write_record(p_dataset_id text, p_paper_id text, p_data jsonb, p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := (select auth.uid());
  current_row public.paper_reading_records%rowtype;
begin
  if caller is null or not public.paper_aisle_sync_access() then
    raise exception 'Sync access denied' using errcode = '42501';
  end if;
  if p_dataset_id is null or length(p_dataset_id) not between 1 and 200
     or p_paper_id is null or length(p_paper_id) not between 1 and 500
     or p_paper_id in ('__proto__','constructor','prototype')
     or p_expected_revision is null or p_expected_revision < 0
     or not public.paper_aisle_valid_record(p_data) then
    raise exception 'Invalid record' using errcode = '22023';
  end if;
  if p_expected_revision = 0 then
    insert into public.paper_reading_records(user_id,dataset_id,paper_id,data)
    values(caller,p_dataset_id,p_paper_id,p_data)
    on conflict do nothing returning * into current_row;
    if found then return jsonb_build_object('applied',true,'record',to_jsonb(current_row)); end if;
  end if;
  select * into current_row from public.paper_reading_records
    where user_id=caller and dataset_id=p_dataset_id and paper_id=p_paper_id for update;
  if not found then
    return jsonb_build_object('applied',false,'record',jsonb_build_object('paper_id',p_paper_id,'data','{}'::jsonb,'revision',0,'updated_at',now()));
  end if;
  if current_row.revision <> p_expected_revision then
    return jsonb_build_object('applied',false,'record',to_jsonb(current_row));
  end if;
  update public.paper_reading_records set data=p_data,revision=revision+1,updated_at=clock_timestamp()
    where user_id=caller and dataset_id=p_dataset_id and paper_id=p_paper_id returning * into current_row;
  return jsonb_build_object('applied',true,'record',to_jsonb(current_row));
end;
$$;
revoke all on function public.paper_aisle_write_record(text,text,jsonb,bigint) from public, anon;
grant execute on function public.paper_aisle_write_record(text,text,jsonb,bigint) to authenticated;
