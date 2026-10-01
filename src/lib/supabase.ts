import { createClient } from '@supabase/supabase-js';

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const r2PublicUrl = (import.meta.env.VITE_R2_PUBLIC_URL || '').replace(/\/$/, '');

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
}
if (!r2PublicUrl) {
  console.warn('R2 public URL not configured. Set VITE_R2_PUBLIC_URL.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType: 'pkce',
  },
});

// Photos live in Cloudflare R2, not Supabase Storage — R2 has zero egress
// fees, which is what pushed this project toward Supabase's paid tier.
// Supabase Auth still gates who can write: the get-upload-url and
// delete-photo edge functions are JWT-verified, and the actual file bytes
// never pass through Supabase (upload PUTs straight to a presigned R2 URL),
// so this doesn't count against Supabase's quotas either.
export async function uploadStopPhoto(file: File, stopKey: string) {
  const { data: urlData, error: fnError } = await supabase.functions.invoke('get-upload-url', {
    body: { stopKey, filename: file.name },
  });
  if (fnError || !urlData?.uploadUrl) {
    return { path: '', error: fnError ?? new Error('No upload URL returned') };
  }

  const putRes = await fetch(urlData.uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
  });
  if (!putRes.ok) {
    return { path: '', error: new Error(`R2 upload failed: ${putRes.status}`) };
  }

  return { path: urlData.path as string, error: null };
}

export function getStopPhotoUrl(path: string) {
  return `${r2PublicUrl}/${path}`;
}

export async function deleteStopPhoto(path: string) {
  const { error } = await supabase.functions.invoke('delete-photo', {
    body: { path },
  });
  return { error };
}
