-- Intrinsic display dimensions (after EXIF rotation) for each photo/video, so the
-- journal can reserve the right aspect ratio before the file loads (no layout
-- shift) and pick a correctly sized variant. Nullable: rows from before this
-- migration were backfilled once; any future gaps just fall back to auto sizing.
alter table sailing_stop_photos
  add column if not exists width integer,
  add column if not exists height integer;
