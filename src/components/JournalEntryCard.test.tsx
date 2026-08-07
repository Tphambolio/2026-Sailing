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

describe('JournalEntryCard video support', () => {
  it('renders a video file as a <video> element, not <img>, in the inline content block', () => {
    const videoMedia = { ...photo, id: 'video-1', storage_path: 'dubrovnik/clip.mp4' };
    mockUseAuth.mockReturnValue({ user: { id: 'user-1' } });
    mockUseStopNotes.mockReturnValue({
      content: '{{photo:video-1}}',
      loading: false,
      saving: false,
      save: vi.fn(),
    });
    mockUseStopPhotos.mockReturnValue({
      photos: [videoMedia],
      loading: false,
      upload: vi.fn(),
      remove: vi.fn(),
      getUrl: (path: string) => `https://example.test/${path}`,
    });

    const { container } = render(<JournalEntryCard stop={stop} />);

    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute('src', 'https://example.test/dubrovnik/clip.mp4');
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('JournalEntryCard file picker double-open guard', () => {
  it('does not fire the OS file chooser twice on a rapid double-tap', async () => {
    setup('');
    const { container } = render(<JournalEntryCard stop={stop} />);

    const fileInput = container.querySelector('input[type="file"][accept="image/*"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(fileInput, 'click').mockImplementation(() => {});

    const user = userEvent.setup();
    const addPhotosBtn = screen.getByRole('button', { name: /add photos/i });
    // Two taps in quick succession, before any change/focus event resets the guard.
    await user.click(addPhotosBtn);
    await user.click(addPhotosBtn);

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });
});
