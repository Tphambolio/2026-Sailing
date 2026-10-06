-- Let the three editors edit photo captions (there was no UPDATE policy, so
-- any update was silently rejected by RLS). Same allowlist as insert/delete.
drop policy if exists "Editors can update stop photos" on sailing_stop_photos;
create policy "Editors can update stop photos" on sailing_stop_photos
  for update
  using (lower(auth.jwt() ->> 'email') = any (array['travisjohnkennedy@gmail.com', 'claire.st.aubin@gmail.com', 'vivian.st.aubin.kennedy@gmail.com']))
  with check (lower(auth.jwt() ->> 'email') = any (array['travisjohnkennedy@gmail.com', 'claire.st.aubin@gmail.com', 'vivian.st.aubin.kennedy@gmail.com']));
