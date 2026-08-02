import { useState, useEffect, useCallback } from 'react';
import { supabase, uploadStopPhoto, deleteStopPhoto, getStopPhotoUrl } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

export interface StopPhoto {
  id: string;
  stop_key: string;
  storage_path: string;
  caption: string | null;
  created_by: string | null;
  created_at: string;
}

// Public read (anyone), write gated by RLS to signed-in users only.
export function useStopNotes(stopKey: string) {
  const { user } = useAuth();
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('sailing_stop_notes')
      .select('content')
      .eq('stop_key', stopKey)
      .maybeSingle();
    if (error) setError(error.message);
    setContent(data?.content ?? '');
    setLoading(false);
  }, [stopKey]);

  useEffect(() => { refetch(); }, [refetch]);

  const save = useCallback(async (newContent: string) => {
    if (!user) return { error: new Error('Not signed in') };
    setSaving(true);
    setError(null);
    const { error } = await supabase
      .from('sailing_stop_notes')
      .upsert({ stop_key: stopKey, content: newContent, updated_by: user.id, updated_at: new Date().toISOString() });
    setSaving(false);
    if (error) { setError(error.message); return { error }; }
    setContent(newContent);
    return { error: null };
  }, [stopKey, user]);

  return { content, loading, saving, error, save, refetch };
}

export function useStopPhotos(stopKey: string) {
  const { user } = useAuth();
  const [photos, setPhotos] = useState<StopPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('sailing_stop_photos')
      .select('*')
      .eq('stop_key', stopKey)
      .order('created_at', { ascending: false });
    if (error) setError(error.message);
    setPhotos(data ?? []);
    setLoading(false);
  }, [stopKey]);

  useEffect(() => { refetch(); }, [refetch]);

  const upload = useCallback(async (file: File, caption?: string) => {
    if (!user) return { error: new Error('Not signed in') };
    setUploading(true);
    setError(null);

    const { path, error: uploadError } = await uploadStopPhoto(file, stopKey);
    if (uploadError) { setError(uploadError.message); setUploading(false); return { error: uploadError }; }

    const { data, error: dbError } = await supabase
      .from('sailing_stop_photos')
      .insert({ stop_key: stopKey, storage_path: path, caption: caption || null, created_by: user.id })
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

  return { photos, loading, uploading, error, upload, remove, getUrl: getStopPhotoUrl, refetch };
}
