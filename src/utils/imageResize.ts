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
