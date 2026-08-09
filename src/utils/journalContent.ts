// Shared parsing for journal/notes content, which may contain inline photo
// placement tokens of the form {{photo:ID}}. Used by both JournalEntryCard
// (the Journal tab) and NotesModal (the map view's Notes popup) so the two
// editors agree on what the saved `content` string means.
//
// The token stays "photo" for both images and videos — it just references a
// row in the same stop-media table/bucket. Which element to render (<img> vs
// <video>) is decided separately, by file extension, so no schema or token
// format change was needed to add video support.

const PHOTO_TOKEN = /\{\{photo:([a-zA-Z0-9-]+)\}\}/g;

export type ContentBlock = { type: 'text'; text: string } | { type: 'photo'; id: string };

export function parseContent(content: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  let lastIndex = 0;
  for (const match of content.matchAll(PHOTO_TOKEN)) {
    const text = content.slice(lastIndex, match.index);
    if (text.trim()) blocks.push({ type: 'text', text });
    blocks.push({ type: 'photo', id: match[1] });
    lastIndex = (match.index ?? 0) + match[0].length;
  }
  const rest = content.slice(lastIndex);
  if (rest.trim()) blocks.push({ type: 'text', text: rest });
  return blocks;
}

const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'webm', 'm4v', 'avi', 'mkv']);

export function isVideoPath(storagePath: string): boolean {
  const ext = storagePath.split('.').pop()?.toLowerCase();
  return !!ext && VIDEO_EXTENSIONS.has(ext);
}

// The saved format is always {{photo:UUID}} — that's what parseContent above
// and every other reader of `content` understands. But a textarea full of
// {{photo:e118aa45-1ae6-433d-b38b-dbaf02726517}} repeated several times is
// unreadable to write around. These give the *editor* a short {{photo 3}}
// form instead, translated back to real UUIDs only at save time — nothing
// that reads saved content ever sees the short form.
const SHORT_PHOTO_TOKEN = /\{\{photo (\d+)\}\}/g;

/** Numbers each distinct photo UUID by the order it first appears in `content`, 1-based. */
export function buildPhotoNumberMap(content: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const match of content.matchAll(PHOTO_TOKEN)) {
    const id = match[1];
    if (!map.has(id)) map.set(id, map.size + 1);
  }
  return map;
}

/** {{photo:UUID}} -> {{photo N}}, for display in the editor. */
export function toShortForm(content: string, numberMap: Map<string, number>): string {
  return content.replace(PHOTO_TOKEN, (whole, id: string) => {
    const num = numberMap.get(id);
    return num !== undefined ? `{{photo ${num}}}` : whole;
  });
}

/** {{photo N}} -> {{photo:UUID}}, for saving. Unmapped numbers (e.g. hand-edited
 *  text) pass through unchanged rather than being silently dropped. */
export function toFullForm(shortContent: string, numberMap: Map<string, number>): string {
  const idByNumber = new Map(Array.from(numberMap.entries()).map(([id, num]) => [num, id]));
  return shortContent.replace(SHORT_PHOTO_TOKEN, (whole, numStr: string) => {
    const id = idByNumber.get(parseInt(numStr, 10));
    return id ? `{{photo:${id}}}` : whole;
  });
}

/** Photo IDs referenced by the short-form editor draft, via the same number map. */
export function shortFormPhotoIds(shortContent: string, numberMap: Map<string, number>): Set<string> {
  const idByNumber = new Map(Array.from(numberMap.entries()).map(([id, num]) => [num, id]));
  const ids = new Set<string>();
  for (const match of shortContent.matchAll(SHORT_PHOTO_TOKEN)) {
    const id = idByNumber.get(parseInt(match[1], 10));
    if (id) ids.add(id);
  }
  return ids;
}
