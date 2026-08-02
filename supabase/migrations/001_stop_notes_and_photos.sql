-- 2026-Sailing (Mediterranean Odyssey map) - notes & photos
-- Run in the Supabase SQL Editor. Shares the med-odyssey-journal project;
-- table/bucket names are prefixed "sailing_" to avoid colliding with that app's schema.

create extension if not exists "uuid-ossp";

-- Notes: one editable text blob per stop, public to read, sign-in required to write.
-- stop_key is a stable slug (not the numeric id, which shifts if stops are reordered).
create table if not exists sailing_stop_notes (
  stop_key text primary key,
  content text not null default '',
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_by uuid references auth.users(id)
);

alter table sailing_stop_notes enable row level security;

create policy "Public can read stop notes"
  on sailing_stop_notes for select
  using (true);

create policy "Signed-in users can add stop notes"
  on sailing_stop_notes for insert
  with check (auth.uid() is not null);

create policy "Signed-in users can edit stop notes"
  on sailing_stop_notes for update
  using (auth.uid() is not null);

-- Photos: many per stop, public to read, sign-in required to add/remove.
create table if not exists sailing_stop_photos (
  id uuid default uuid_generate_v4() primary key,
  stop_key text not null,
  storage_path text not null,
  caption text,
  created_by uuid references auth.users(id),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists idx_sailing_stop_photos_stop_key on sailing_stop_photos(stop_key);

alter table sailing_stop_photos enable row level security;

create policy "Public can read stop photos"
  on sailing_stop_photos for select
  using (true);

create policy "Signed-in users can add stop photos"
  on sailing_stop_photos for insert
  with check (auth.uid() is not null);

create policy "Signed-in users can delete stop photos"
  on sailing_stop_photos for delete
  using (auth.uid() is not null);

-- Storage bucket for the actual image files, organized as <stop_key>/<filename>
insert into storage.buckets (id, name, public)
values ('sailing-stop-photos', 'sailing-stop-photos', true)
on conflict (id) do nothing;

create policy "Public can view sailing stop photo files"
  on storage.objects for select
  using (bucket_id = 'sailing-stop-photos');

create policy "Signed-in users can upload sailing stop photo files"
  on storage.objects for insert
  with check (bucket_id = 'sailing-stop-photos' and auth.uid() is not null);

create policy "Signed-in users can delete sailing stop photo files"
  on storage.objects for delete
  using (bucket_id = 'sailing-stop-photos' and auth.uid() is not null);
