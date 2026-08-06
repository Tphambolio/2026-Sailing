import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import JournalEntryCard from './JournalEntryCard';
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

function setup(content = '') {
  mockUseAuth.mockReturnValue({ user: { id: 'user-1' } });
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

describe('JournalEntryCard photo picker', () => {
  it('marks a photo "in text" as soon as it is inserted into the draft, before Save', async () => {
    setup('');
    const user = userEvent.setup();
    render(<JournalEntryCard stop={stop} />);

    await user.click(screen.getByRole('button', { name: /edit/i }));

    const thumbnail = screen.getByTitle('Insert into text');
    expect(thumbnail).not.toHaveTextContent('in text');

    await user.click(thumbnail);

    // Re-query by title rather than accessible name — the button's name changes
    // once it contains "in text" text content, which would shadow the title.
    expect(screen.getByTitle('Insert into text')).toHaveTextContent('in text');
  });
});
