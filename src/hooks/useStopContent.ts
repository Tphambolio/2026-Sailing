import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, uploadStopPhoto, deleteStopPhoto, getStopPhotoUrl } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { describeMedia } from '../utils/imageResize';

export interface StopPhoto {
  id: string;
  stop_key: string;
  storage_path: string;
  caption: string | null;
  created_by: string | null;
  created_at: string;
  // Display dimensions (post-rotation); null for rows that predate them.
  width?: number | null;
  height?: number | null;
}

const fetchNote = (stopKey: string) =>
  supabase.from('sailing_stop_notes').select('content, updated_at').eq('stop_key', stopKey).maybeSingle();
const fetchPhotos = (stopKey: string) =>
  supabase.from('sailing_stop_photos').select('*').eq('stop_key', stopKey).order('created_at', { ascending: false });

// Public read (anyone), write gated by RLS to the three editors.
export function useStopNotes(stopKey: string) {
  const { user } = useAuth();
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A failed load must never look like an empty entry — writing into it would
  // overwrite the real text. Editing is blocked until a load succeeds.
  const [loadFailed, setLoadFailed] = useState(false);
  // updated_at of the version this device loaded/saved; null = server has no row.
  const versionRef = useRef<string | null>(null);

  const apply = useCallback(({ data, error }: Awaited<ReturnType<typeof fetchNote>>) => {
    if (error) {
      setError(error.message);
      setLoadFailed(true);
    } else {
      setError(null);
      setLoadFailed(false);
      setContent(data?.content ?? '');
      versionRef.current = data?.updated_at ?? null;
    }
    setLoading(false);
  }, []);
  const refetch = useCallback(async () => { setLoading(true); apply(await fetchNote(stopKey)); }, [stopKey, apply]);

  useEffect(() => {
    let ignore = false; // a late response after unmount/key change must not set state
    fetchNote(stopKey).then(result => { if (!ignore) apply(result); });
    return () => { ignore = true; };
  }, [stopKey, apply]);

  const save = useCallback(async (newContent: string) => {
    if (!user) return { error: new Error('Not signed in') };
    if (loadFailed) return { error: new Error("This entry didn't load, so it can't be saved safely — reload and try again.") };
    setSaving(true);
    setError(null);
    const updatedAt = new Date().toISOString();
    const row = { stop_key: stopKey, content: newContent, updated_by: user.id, updated_at: updatedAt };
    let saveError: Error | null = null;

    if (versionRef.current === null) {
      // No entry yet: insert (not upsert), so a concurrent first save by
      // another editor fails loudly instead of being overwritten.
      const { error } = await supabase.from('sailing_stop_notes').insert(row);
      if (error) saveError = error.code === '23505' ? new Error(CONFLICT_MESSAGE) : error;
    } else {
      // Only overwrite the version we loaded — otherwise someone else saved in between.
      const { data, error } = await supabase
        .from('sailing_stop_notes')
        .update(row)
        .eq('stop_key', stopKey)
        .eq('updated_at', versionRef.current)
        .select('updated_at');
      if (error) saveError = error;
      else if (!data || data.length === 0) saveError = new Error(CONFLICT_MESSAGE);
    }

    setSaving(false);
    if (saveError) { setError(saveError.message); return { error: saveError }; }
    versionRef.current = updatedAt;
    setContent(newContent);
    return { error: null };
  }, [stopKey, user, loadFailed]);

  return { content, loading, saving, error, loadFailed, save, refetch };
}

const CONFLICT_MESSAGE = 'Someone else saved this entry while you were editing, so yours wasn\'t saved (to avoid overwriting theirs). Copy your text, reload, and merge.';

export function useStopPhotos(stopKey: string) {
  const { user } = useAuth();
  const [photos, setPhotos] = useState<StopPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback(({ data, error }: Awaited<ReturnType<typeof fetchPhotos>>) => {
    if (error) setError(error.message);
    setPhotos((data ?? []) as StopPhoto[]);
    setLoading(false);
  }, []);
  const refetch = useCallback(async () => { setLoading(true); apply(await fetchPhotos(stopKey)); }, [stopKey, apply]);

  useEffect(() => {
    let ignore = false;
    fetchPhotos(stopKey).then(result => { if (!ignore) apply(result); });
    return () => { ignore = true; };
  }, [stopKey, apply]);

  const upload = useCallback(async (file: File, caption?: string) => {
    if (!user) return { error: new Error('Not signed in') };
    setUploading(true);
    setError(null);

    const info = await describeMedia(file);
    const { path, error: uploadError } = await uploadStopPhoto(file, stopKey, info?.variants);
    if (uploadError) { setError(uploadError.message); setUploading(false); return { error: uploadError }; }

    const { data, error: dbError } = await supabase
      .from('sailing_stop_photos')
      .insert({ stop_key: stopKey, storage_path: path, caption: caption || null, created_by: user.id, width: info?.width ?? null, height: info?.height ?? null })
      .select()
      .single();

    setUploading(false);
    if (dbError) { setError(dbError.message); return { error: dbError }; }
    setPhotos(prev => [data, ...prev]);
    return { data, error: null };
  }, [stopKey, user]);

  const remove = useCallback(async (photo: StopPhoto) => {
    const { error: storageError } = await deleteStopPhoto(photo.storage_path);
    if (storageError) { setError(storageError.message); return { error: storageError }; }
    const { error: dbError } = await supabase.from('sailing_stop_photos').delete().eq('id', photo.id);
    if (dbError) { setError(dbError.message); return { error: dbError }; }
    setPhotos(prev => prev.filter(p => p.id !== photo.id));
    return { error: null };
  }, []);

  const setCaption = useCallback(async (photo: StopPhoto, caption: string) => {
    const value = caption.trim() || null;
    const { data, error: dbError } = await supabase
      .from('sailing_stop_photos')
      .update({ caption: value })
      .eq('id', photo.id)
      .select()
      .single();
    if (dbError) { setError(dbError.message); return { error: dbError }; }
    setPhotos(prev => prev.map(p => (p.id === photo.id ? { ...p, ...data } : p)));
    return { error: null };
  }, []);

  return { photos, loading, uploading, error, upload, remove, setCaption, getUrl: getStopPhotoUrl, refetch };
}
