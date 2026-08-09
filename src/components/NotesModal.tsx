import type { Stop } from '../types';
import JournalEntryCard from './JournalEntryCard';

interface NotesModalProps {
  stop: Stop;
  isCurrent?: boolean;
  onClose: () => void;
}

// A modal shell around JournalEntryCard — the notes/photos/Google Photos editor
// used to be duplicated here with its own copy of every handler, which is how
// features like Google Photos import (and the image-downsample fix) landed in
// the Journal tab but silently never made it here. One implementation now;
// this is just the popup chrome (backdrop, close button, scroll container)
// around it. Visited/arrival/departure controls are deliberately left off —
// the map's info bar behind this modal already has those, right next to it.
export default function NotesModal({ stop, isCurrent, onClose }: NotesModalProps) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[10000] p-4" onClick={onClose}>
      <div className="max-w-lg w-full relative" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="absolute -top-3 -right-3 z-10 w-8 h-8 flex items-center justify-center bg-slate-700 hover:bg-slate-600 rounded-full text-white shadow-lg"
          title="Close"
        >
          ✕
        </button>
        <div className="max-h-[85vh] overflow-y-auto rounded-xl">
          <JournalEntryCard stop={stop} isCurrent={isCurrent} onEmptyAndCancelled={onClose} />
        </div>
      </div>
    </div>
  );
}
