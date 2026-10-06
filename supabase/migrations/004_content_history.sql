-- Loss-proofing: keep every previous version of journal text and the itinerary.
-- Supabase's free plan has no point-in-time recovery, and both tables are
-- overwritten in place on save (that's how the July 12 entry was lost), so a
-- BEFORE UPDATE/DELETE trigger archives the old row first. Runs inside Postgres,
-- so no client, script or dashboard edit can skip it.
--
-- History tables have RLS on with no policies: invisible to the site and to
-- anon/authenticated users; readable only via the dashboard / service role.

create table if not exists sailing_stop_notes_history (
  id bigserial primary key,
  stop_key text not null,
  content text not null,
  updated_at timestamptz,
  updated_by uuid,
  operation text not null,          -- 'UPDATE' or 'DELETE'
  archived_at timestamptz not null default now()
);
create index if not exists sailing_stop_notes_history_key_idx on sailing_stop_notes_history (stop_key, archived_at desc);
alter table sailing_stop_notes_history enable row level security;

create table if not exists sailing_trip_stops_history (
  id bigserial primary key,
  stops jsonb not null,
  updated_at timestamptz,
  updated_by text,
  operation text not null,
  archived_at timestamptz not null default now()
);
create index if not exists sailing_trip_stops_history_archived_idx on sailing_trip_stops_history (archived_at desc);
alter table sailing_trip_stops_history enable row level security;

create or replace function archive_stop_note() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Skip no-op saves so the history isn't flooded with identical copies.
  if tg_op = 'UPDATE' and new.content is not distinct from old.content then
    return new;
  end if;
  insert into sailing_stop_notes_history (stop_key, content, updated_at, updated_by, operation)
  values (old.stop_key, old.content, old.updated_at, old.updated_by, tg_op);
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create or replace function archive_trip_stops() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.stops is not distinct from old.stops then
    return new;
  end if;
  insert into sailing_trip_stops_history (stops, updated_at, updated_by, operation)
  values (old.stops, old.updated_at, old.updated_by::text, tg_op);
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists sailing_stop_notes_archive on sailing_stop_notes;
create trigger sailing_stop_notes_archive
  before update or delete on sailing_stop_notes
  for each row execute function archive_stop_note();

drop trigger if exists sailing_trip_stops_archive on sailing_trip_stops;
create trigger sailing_trip_stops_archive
  before update or delete on sailing_trip_stops
  for each row execute function archive_trip_stops();
