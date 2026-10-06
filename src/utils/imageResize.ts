// Downsamples photos client-side before upload — the same thing every social
// app does on-device rather than shipping full-resolution camera/Google Photos
// originals over the network. Without this, a single phone photo (or a Google
// Photos original pulled via the picker) can be 5-10MB, which is what was
// making Google Photos imports take several minutes: multi-MB downloads from
// Google followed by multi-MB uploads to Supabase, one file at a time.
// 1600px / q0.8 mirrors what Instagram/social feeds actually serve — this app
// is a sailing trip journal, read over marina wifi as often as broadband, so
// erring toward smaller than a "full quality" web image is the right trade.
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.8;
// Below this, a photo is already screen-appropriate — skip the decode/encode
// round-trip rather than possibly making a small file bigger via re-encoding.
const SKIP_BELOW_BYTES = 900_000;

export async function downsampleImage(file: File): Promise<File> {
  // Canvas flattens animated GIFs to one frame and can't touch video at all.
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Formats canvas can't decode (e.g. some HEIC variants) — ship the original
    // rather than failing the whole import over an optional optimization.
    return file;
  }

  try {
    const longestEdge = Math.max(bitmap.width, bitmap.height);
    if (longestEdge <= MAX_DIMENSION && file.size <= SKIP_BELOW_BYTES) return file;

    const scale = Math.min(1, MAX_DIMENSION / longestEdge);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!blob) return file;

    const newName = file.name.replace(/\.\w+$/, '') + '.jpg';
    return new File([blob], newName, { type: 'image/jpeg' });
  } finally {
    bitmap.close();
  }
}

// Width-limited JPEG copies stored next to each original as <name>.w480.jpg and
// <name>.w1000.jpg — thumbnails/previews use w480, inline photos on phones pick
// w1000 via srcset. Saves ~90% of bytes for grids on slow boat connections.
export const VARIANT_WIDTHS = { w480: 480, w1000: 1000 } as const;
export type VariantName = keyof typeof VARIANT_WIDTHS;

export interface MediaInfo {
  width: number;
  height: number;
  variants: Partial<Record<VariantName, Blob>>;
}

/** Points a photo URL at one of its stored size variants (images only). */
export function variantUrl(url: string, variant: VariantName): string {
  return url.replace(/\.(jpe?g|png|webp)$/i, `.${variant}.jpg`);
}

async function imageInfo(file: File): Promise<MediaInfo | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  try {
    const { width, height } = bitmap;
    const variants: MediaInfo['variants'] = {};
    for (const [name, target] of Object.entries(VARIANT_WIDTHS) as [VariantName, number][]) {
      const scale = Math.min(1, target / width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.78));
      if (blob) variants[name] = blob;
    }
    return { width, height, variants };
  } finally {
    bitmap.close();
  }
}

function videoInfo(file: File): Promise<MediaInfo | null> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    const done = (info: MediaInfo | null) => { URL.revokeObjectURL(url); resolve(info); };
    const timer = setTimeout(() => done(null), 8000);
    video.preload = 'metadata';
    video.onloadedmetadata = () => { clearTimeout(timer); done(video.videoWidth ? { width: video.videoWidth, height: video.videoHeight, variants: {} } : null); };
    video.onerror = () => { clearTimeout(timer); done(null); };
    video.src = url;
  });
}

/**
 * Dimensions (for layout-shift-free rendering) plus size variants for an upload.
 * Best-effort: null means "upload without them", never a failed upload.
 */
export async function describeMedia(file: File): Promise<MediaInfo | null> {
  try {
    if (file.type.startsWith('video/')) return await videoInfo(file);
    if (file.type.startsWith('image/') && file.type !== 'image/gif') return await imageInfo(file);
  } catch {
    /* optional optimization — fall through */
  }
  return null;
}
