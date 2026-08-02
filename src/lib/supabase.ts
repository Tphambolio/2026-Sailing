import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType: 'pkce',
  },
});

const PHOTOS_BUCKET = 'sailing-stop-photos';

export async function uploadStopPhoto(file: File, stopKey: string) {
  const fileExt = file.name.split('.').pop();
  const path = `${stopKey}/${Date.now()}.${fileExt}`;
  const { error } = await supabase.storage.from(PHOTOS_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });
  return { path, error };
}

export function getStopPhotoUrl(path: string) {
  const { data } = supabase.storage.from(PHOTOS_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export async function deleteStopPhoto(path: string) {
  const { error } = await supabase.storage.from(PHOTOS_BUCKET).remove([path]);
  return { error };
}
