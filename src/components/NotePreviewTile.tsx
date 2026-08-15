import type { Stop } from '../types';
import { useStopNotes, useStopPhotos } from '../hooks/useStopContent';
import { useAuth } from '../context/AuthContext';
import { parseContent, isVideoPath } from '../utils/journalContent';

const SNIPPET_LENGTH = 160;

interface NotePreviewTileProps {
  stop: Stop;
  onExpand: () => void;
}

// Auto-shown whenever a stop is selected on the map — a compact preview of its
// journal entry, with a click-through to the full NotesModal/JournalEntryCard
// editor instead of duplicating that UI here.
export default function NotePreviewTile({ stop, onExpand }: NotePreviewTileProps) {
  const { user } = useAuth();
  const { content, loading: notesLoading } = useStopNotes(stop.key);
  const { photos, loading: photosLoading, getUrl } = useStopPhotos(stop.key);

  if (notesLoading || photosLoading) return null;

  const snippet = parseContent(content)
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text.trim())
    .join(' ')
    .trim();
  const truncated = snippet.length > SNIPPET_LENGTH ? snippet.slice(0, SNIPPET_LENGTH).trimEnd() + '…' : snippet;
  const hasContent = !!truncated || photos.length > 0;

  // Nothing written yet — only worth a prompt if this viewer could actually add one.
  if (!hasContent) {
    if (!user) return null;
    return (
      <button
        onClick={onExpand}
        className="mb-3 w-full text-left text-sm text-slate-400 hover:text-emerald-400 border border-dashed border-slate-600 hover:border-emerald-500 rounded-lg px-3 py-2 transition-colors"
      >
        {'📝'} No journal entry yet — click to add one
      </button>
    );
  }

  const thumbPhoto = photos.find(p => !isVideoPath(p.storage_path));

  return (
    <button
      onClick={onExpand}
      className="mb-3 w-full flex items-start gap-3 text-left bg-slate-900/60 hover:bg-slate-900 border border-slate-700 hover:border-emerald-500/50 rounded-lg p-2.5 transition-colors"
      title="Read the full entry"
    >
      {thumbPhoto && (
        <img
          src={getUrl(thumbPhoto.storage_path)}
          alt=""
          className="w-14 h-14 rounded object-cover shrink-0"
        />
      )}
      <div className="min-w-0 flex-1">
        {truncated && <p className="text-sm text-slate-300 line-clamp-2">{truncated}</p>}
        <p className="text-xs text-emerald-400 font-medium mt-1">
          {'📝'} Read full entry
          {photos.length > 0 && ` · ${photos.length} photo${photos.length !== 1 ? 's' : ''}`}
          {' →'}
        </p>
      </div>
    </button>
  );
}
