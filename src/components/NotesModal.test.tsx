import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import NotesModal from './NotesModal';
import type { Stop } from '../types';

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

describe('NotesModal', () => {
  it('renders a {{photo:ID}} token (written by the Journal tab) as an image, not raw text', () => {
    mockUseAuth.mockReturnValue({ user: { id: 'user-1' }, signInWithProvider: vi.fn() });
    mockUseStopNotes.mockReturnValue({
      content: 'Great walk along the walls.\n\n{{photo:photo-1}}\n\nSunset after.',
      loading: false,
      saving: false,
      save: vi.fn(),
    });
    mockUseStopPhotos.mockReturnValue({
      photos: [photo],
      loading: false,
      uploading: false,
      upload: vi.fn(),
      remove: vi.fn(),
      getUrl: (path: string) => `https://example.test/${path}`,
    });

    render(<NotesModal stop={stop} onClose={vi.fn()} />);

    expect(screen.getByText('Great walk along the walls.')).toBeInTheDocument();
    expect(screen.getByText('Sunset after.')).toBeInTheDocument();
    expect(screen.queryByText(/\{\{photo:/)).not.toBeInTheDocument();

    // The same photo also appears in the flat Photos grid below, so there are two
    // matches for this alt text — the inline one (in the Notes section) comes first in DOM order.
    const images = screen.getAllByAltText('Dubrovnik');
    expect(images.length).toBeGreaterThanOrEqual(1);
    expect(images[0]).toHaveAttribute('src', 'https://example.test/dubrovnik/1.jpg');
  });
});
