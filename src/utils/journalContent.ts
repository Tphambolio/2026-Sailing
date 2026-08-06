// Shared parsing for journal/notes content, which may contain inline photo
// placement tokens of the form {{photo:ID}}. Used by both JournalEntryCard
// (the Journal tab) and NotesModal (the map view's Notes popup) so the two
// editors agree on what the saved `content` string means.

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
