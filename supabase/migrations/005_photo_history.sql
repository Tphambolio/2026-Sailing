-- Loss-proofing for photos: when a photo row is deleted (the ✕ on a photo),
-- archive it so it can be restored. The file itself is moved to trash/ in R2
-- by the delete-photo edge function rather than erased.
create table if not exists sailing_stop_photos_history (
  id bigserial primary key,
  photo_id uuid not null,
  stop_key text not null,
  storage_path text not null,
  caption text,
  created_by uuid,
  created_at timestamptz,
  width integer,
  height integer,
  operation text not null,
  archived_at timestamptz not null default now()
);
create index if not exists sailing_stop_photos_history_key_idx on sailing_stop_photos_history (stop_key, archived_at desc);
alter table sailing_stop_photos_history enable row level security;

create or replace function archive_stop_photo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into sailing_stop_photos_history (photo_id, stop_key, storage_path, caption, created_by, created_at, width, height, operation)
  values (old.id, old.stop_key, old.storage_path, old.caption, old.created_by, old.created_at, old.width, old.height, tg_op);
  return old;
end $$;

drop trigger if exists sailing_stop_photos_archive on sailing_stop_photos;
create trigger sailing_stop_photos_archive
  before delete on sailing_stop_photos
  for each row execute function archive_stop_photo();
