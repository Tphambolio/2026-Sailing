import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NotesModal from './NotesModal';
import type { Stop } from '../types';

// NotesModal is a thin modal shell around JournalEntryCard — content rendering
// (photo/video tokens, editing, Google Photos, etc.) is JournalEntryCard's own
// responsibility and already covered by JournalEntryCard.test.tsx. These tests
// only cover what NotesModal itself is responsible for: the modal chrome.
const { mockUseAuth, mockUseStopNotes, mockUseStopPhotos } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockUseStopNotes: vi.fn(),
  mockUseStopPhotos: vi.fn(),
}));

vi.mock('../context/AuthContext', () => ({ useAuth: mockUseAuth }));
vi.mock('../hooks/useStopContent', () => ({
  useStopNotes: mockUseStopNotes,
  useStopPhotos: mockUseStopPhotos,
}));

const stop: Stop = {
  id: 1,
  key: 'dubrovnik',
  name: 'Dubrovnik',
  country: 'Croatia',
  lat: 42.65,
  lon: 18.09,
  type: 'marina',
  arrival: '2026-08-10',
  departure: '2026-08-12',
  duration: '2 days',
  distanceToNext: 0,
  season: 'summer',
  phase: 'Croatia',
};

const photo = {
  id: 'photo-1',
  stop_key: 'dubrovnik',
  storage_path: 'dubrovnik/1.jpg',
  caption: null,
  created_by: 'user-1',
  created_at: '2026-08-05T00:00:00Z',
};

function setup(content = '') {
  mockUseAuth.mockReturnValue({ user: { id: 'user-1' }, signInWithProvider: vi.fn() });
  mockUseStopNotes.mockReturnValue({
    content,
    loading: false,
    saving: false,
    save: vi.fn().mockResolvedValue({ error: null }),
  });
  mockUseStopPhotos.mockReturnValue({
    photos: [photo],
    loading: false,
    upload: vi.fn(),
    remove: vi.fn(),
    getUrl: (path: string) => `https://example.test/${path}`,
  });
}

describe('NotesModal', () => {
  it('renders the stop via JournalEntryCard, with a photo token shown only once (not duplicated in a separate grid)', () => {
    setup('Great walk along the walls.\n\n{{photo:photo-1}}\n\nSunset after.');

    render(<NotesModal stop={stop} onClose={vi.fn()} />);

    expect(screen.getByRole('heading', { name: /Dubrovnik/ })).toBeInTheDocument();
    expect(screen.getByText('Great walk along the walls.')).toBeInTheDocument();
    expect(screen.getByText('Sunset after.')).toBeInTheDocument();
    expect(screen.queryByText(/\{\{photo:/)).not.toBeInTheDocument();
    // Unified behavior: a photo referenced inline no longer also appears in a
    // separate flat gallery below it, unlike the old duplicated NotesModal.
    expect(screen.getAllByAltText('Dubrovnik')).toHaveLength(1);
  });

  it('calls onClose when the close button is clicked', () => {
    setup('');
    const onClose = vi.fn();
    render(<NotesModal stop={stop} onClose={onClose} />);

    fireEvent.click(screen.getByTitle('Close'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the backdrop is clicked', () => {
    setup('');
    const onClose = vi.fn();
    const { container } = render(<NotesModal stop={stop} onClose={onClose} />);

    fireEvent.click(container.firstChild as Element);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when clicking inside the card itself', () => {
    setup('Some existing notes.');
    const onClose = vi.fn();
    render(<NotesModal stop={stop} onClose={onClose} />);

    fireEvent.click(screen.getByText('Some existing notes.'));

    expect(onClose).not.toHaveBeenCalled();
  });
});
