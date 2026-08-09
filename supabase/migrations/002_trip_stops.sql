-- 2026-Sailing (Mediterranean Odyssey map) - itinerary persistence
-- Run in the Supabase SQL Editor. Same project as 001_stop_notes_and_photos.sql.
--
-- The full stops array (adds, edits, deletes, reordering, dates, culture
-- highlights, everything the map/table/calendar views render) previously
-- lived only in the editing browser's localStorage — invisible on any other
-- device and one "clear browsing data" away from being lost entirely, unlike
-- journal notes/photos which were already synced here. Singleton row (id
-- always 1) since this app has exactly one itinerary, matching how the app
-- already treats the trip as a single shared document rather than per-user.

create table if not exists sailing_trip_stops (
  id int primary key default 1,
  stops jsonb not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_by uuid references auth.users(id),
  constraint sailing_trip_stops_singleton check (id = 1)
);

alter table sailing_trip_stops enable row level security;

create policy "Public can read trip stops"
  on sailing_trip_stops for select
  using (true);

create policy "Signed-in users can save trip stops"
  on sailing_trip_stops for insert
  with check (auth.uid() is not null);

create policy "Signed-in users can update trip stops"
  on sailing_trip_stops for update
  using (auth.uid() is not null);

create policy "Signed-in users can delete trip stops"
  on sailing_trip_stops for delete
  using (auth.uid() is not null);
