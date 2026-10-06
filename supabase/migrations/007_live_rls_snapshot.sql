-- Snapshot of the LIVE row-level-security policies on the journal tables.
-- They were tightened to the three editor emails through the dashboard, so the
-- earlier migrations (001/002: 'auth.uid() is not null') no longer describe the
-- database. Generated from pg_policies on 2026-10-06; re-running is idempotent.
-- Keep the email list in sync with src/data/constants.ts EDITOR_EMAILS and
-- supabase/functions/_shared/requireEditor.ts.

drop policy if exists "Signed-in users can add stop notes" on public.sailing_stop_notes;
create policy "Signed-in users can add stop notes" on public.sailing_stop_notes for insert
  with check ((lower((auth.jwt() ->> 'email'::text)) = ANY (ARRAY['travisjohnkennedy@gmail.com'::text, 'claire.st.aubin@gmail.com'::text, 'vivian.st.aubin.kennedy@gmail.com'::text])));

drop policy if exists "Public can read stop notes" on public.sailing_stop_notes;
create policy "Public can read stop notes" on public.sailing_stop_notes for select
  using (true);

drop policy if exists "Signed-in users can edit stop notes" on public.sailing_stop_notes;
create policy "Signed-in users can edit stop notes" on public.sailing_stop_notes for update
  using ((lower((auth.jwt() ->> 'email'::text)) = ANY (ARRAY['travisjohnkennedy@gmail.com'::text, 'claire.st.aubin@gmail.com'::text, 'vivian.st.aubin.kennedy@gmail.com'::text])));

drop policy if exists "Signed-in users can delete stop photos" on public.sailing_stop_photos;
create policy "Signed-in users can delete stop photos" on public.sailing_stop_photos for delete
  using ((lower((auth.jwt() ->> 'email'::text)) = ANY (ARRAY['travisjohnkennedy@gmail.com'::text, 'claire.st.aubin@gmail.com'::text, 'vivian.st.aubin.kennedy@gmail.com'::text])));

drop policy if exists "Signed-in users can add stop photos" on public.sailing_stop_photos;
create policy "Signed-in users can add stop photos" on public.sailing_stop_photos for insert
  with check ((lower((auth.jwt() ->> 'email'::text)) = ANY (ARRAY['travisjohnkennedy@gmail.com'::text, 'claire.st.aubin@gmail.com'::text, 'vivian.st.aubin.kennedy@gmail.com'::text])));

drop policy if exists "Public can read stop photos" on public.sailing_stop_photos;
create policy "Public can read stop photos" on public.sailing_stop_photos for select
  using (true);

drop policy if exists "Editors can update stop photos" on public.sailing_stop_photos;
create policy "Editors can update stop photos" on public.sailing_stop_photos for update
  using ((lower((auth.jwt() ->> 'email'::text)) = ANY (ARRAY['travisjohnkennedy@gmail.com'::text, 'claire.st.aubin@gmail.com'::text, 'vivian.st.aubin.kennedy@gmail.com'::text])))
  with check ((lower((auth.jwt() ->> 'email'::text)) = ANY (ARRAY['travisjohnkennedy@gmail.com'::text, 'claire.st.aubin@gmail.com'::text, 'vivian.st.aubin.kennedy@gmail.com'::text])));

drop policy if exists "Signed-in users can delete trip stops" on public.sailing_trip_stops;
create policy "Signed-in users can delete trip stops" on public.sailing_trip_stops for delete
  using ((lower((auth.jwt() ->> 'email'::text)) = ANY (ARRAY['travisjohnkennedy@gmail.com'::text, 'claire.st.aubin@gmail.com'::text, 'vivian.st.aubin.kennedy@gmail.com'::text])));

drop policy if exists "Signed-in users can save trip stops" on public.sailing_trip_stops;
create policy "Signed-in users can save trip stops" on public.sailing_trip_stops for insert
  with check ((lower((auth.jwt() ->> 'email'::text)) = ANY (ARRAY['travisjohnkennedy@gmail.com'::text, 'claire.st.aubin@gmail.com'::text, 'vivian.st.aubin.kennedy@gmail.com'::text])));

drop policy if exists "Public can read trip stops" on public.sailing_trip_stops;
create policy "Public can read trip stops" on public.sailing_trip_stops for select
  using (true);

drop policy if exists "Signed-in users can update trip stops" on public.sailing_trip_stops;
create policy "Signed-in users can update trip stops" on public.sailing_trip_stops for update
  using ((lower((auth.jwt() ->> 'email'::text)) = ANY (ARRAY['travisjohnkennedy@gmail.com'::text, 'claire.st.aubin@gmail.com'::text, 'vivian.st.aubin.kennedy@gmail.com'::text])));
