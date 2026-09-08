// Supabase Storage hard-caps uploads at 50MB on this project's plan (see
// JournalEntryCard's MAX_UPLOAD_BYTES) — a phone video clip clears that far
// more often than a photo does (downsampleImage() already shrinks photos).
// Rather than reject the whole clip and send the user off to re-export it
// manually, this trims the tail off client-side so it fits, keeping playback
// from the start intact.
//
// Uses ffmpeg.wasm's single-threaded core specifically — the multi-threaded
// build needs SharedArrayBuffer, which needs COOP/COEP response headers a
// static GitHub Pages site has no way to set. The core JS/WASM (~30MB) are
// fetched from a CDN rather than bundled — they're only needed for the rare
// oversized clip — and converted to blob: URLs via @ffmpeg/util's toBlobURL,
// which is the documented way around the cross-origin restrictions on
// loading a worker script from another origin directly.
//
// The trim itself uses `-c copy` (stream copy, no re-encode): cutting by
// duration instead of re-encoding keeps the original quality and finishes in
// roughly the time it takes to read the file rather than the time it'd take
// to recompress it.
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL, fetchFile } from '@ffmpeg/util';

// Pinned to match the @ffmpeg/core devDependency version — bumping one
// without the other risks a JS/WASM API mismatch at runtime.
const FFMPEG_CORE_VERSION = '0.12.10';
const CORE_BASE_URL = `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/esm`;

// A stream-copy trim can only cut on a keyframe boundary, not to the exact
// byte, so it routinely overshoots a plain proportional target a little —
// this headroom is what makes one pass reliably land under the limit instead
// of needing a retry.
const SAFETY_MARGIN = 0.92;
// Very long keyframe intervals can still overshoot even with the margin
// above; retry with a tighter target rather than giving up after one try.
const MAX_ATTEMPTS = 3;

let ffmpegPromise: Promise<FFmpeg> | null = null;

function loadFFmpeg(): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const ffmpeg = new FFmpeg();
      await ffmpeg.load({
        coreURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      return ffmpeg;
    })().catch((err) => {
      // Don't cache a rejected load — a transient CDN blip shouldn't
      // permanently disable trimming for the rest of the tab's lifetime.
      ffmpegPromise = null;
      throw err;
    });
  }
  return ffmpegPromise;
}

function getVideoDurationSeconds(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    const cleanup = () => URL.revokeObjectURL(url);
    video.addEventListener('loadedmetadata', () => {
      cleanup();
      if (Number.isFinite(video.duration) && video.duration > 0) resolve(video.duration);
      else reject(new Error('Could not read video duration'));
    });
    video.addEventListener('error', () => {
      cleanup();
      reject(new Error('Could not read video metadata'));
    });
    video.preload = 'metadata';
    video.src = url;
  });
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? 'mp4' : name.slice(dot + 1);
}

/**
 * Trims the end off a video so it fits under maxBytes, re-using the file's
 * original quality/codec (stream copy — no re-encode). Returns the file
 * unchanged if it's already under the limit. Throws if the file can't be
 * trimmed (ffmpeg failed to load, duration unreadable, or it's still over
 * the limit after every attempt) — callers should fall back to rejecting
 * the upload in that case, same as before this existed.
 */
export async function trimVideoToSizeLimit(file: File, maxBytes: number): Promise<File> {
  if (file.size <= maxBytes) return file;

  const duration = await getVideoDurationSeconds(file);
  const ffmpeg = await loadFFmpeg();
  const ext = fileExtension(file.name);
  const inputName = `input.${ext}`;
  const outputName = `trimmed.${ext}`;

  await ffmpeg.writeFile(inputName, await fetchFile(file));
  try {
    let targetDuration = duration * (maxBytes / file.size) * SAFETY_MARGIN;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const code = await ffmpeg.exec(['-i', inputName, '-t', targetDuration.toFixed(2), '-c', 'copy', outputName]);
      if (code !== 0) throw new Error(`ffmpeg exited with code ${code}`);

      const data = await ffmpeg.readFile(outputName);
      const bytes = data as Uint8Array;
      if (bytes.byteLength <= maxBytes) {
        // ffmpeg.wasm's FileData type is generic over ArrayBufferLike (which
        // includes SharedArrayBuffer); File's BlobPart wants a plain
        // ArrayBuffer specifically. Copying into a fresh Uint8Array satisfies
        // that without actually recopying anything meaningful in practice.
        return new File([new Uint8Array(bytes)], file.name, { type: file.type });
      }

      await ffmpeg.deleteFile(outputName);
      // Shrink proportionally to how far over we landed, for the next pass.
      targetDuration *= maxBytes / bytes.byteLength;
    }

    throw new Error(`still over the limit after ${MAX_ATTEMPTS} attempts`);
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {});
  }
}
