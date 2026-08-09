import { describe, it, expect, vi, afterEach } from 'vitest';
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

describe('JournalEntryCard displayed date', () => {
  it('shows the actual date, not the auto-cascaded planned one, when actualArrival is set', () => {
    // Mirrors a stop appended out of chronological sequence (e.g. via the
    // map's "Add Stop", which always appends at the end): its planned
    // arrival/departure are stale, cascaded from wherever it landed in the
    // array, while actualArrival/actualDeparture hold the real day.
    const outOfSequenceStop: Stop = {
      ...stop,
      arrival: '2027-05-17',
      departure: '2027-05-18',
      actualArrival: '2026-08-04',
      actualDeparture: '2026-08-05',
    };
    setup('Some notes about this day.');

    render(<JournalEntryCard stop={outOfSequenceStop} />);

    expect(screen.getByText(/4 Aug/)).toBeInTheDocument();
    expect(screen.queryByText(/17 May/)).not.toBeInTheDocument();
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

describe('JournalEntryCard share to Instagram', () => {
  // jsdom has no Web Share API at all, so share/canShare need a real property
  // definition to exist. navigator.clipboard.writeText, on the other hand,
  // IS implemented by jsdom — spying on the existing method (rather than
  // trying to shadow the whole clipboard object) is what actually sticks.
  const navProps = ['share', 'canShare'] as const;

  afterEach(() => {
    navProps.forEach(p => { delete (navigator as unknown as Record<string, unknown>)[p]; });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function defineNavProp(name: (typeof navProps)[number], value: unknown) {
    Object.defineProperty(navigator, name, { value, configurable: true, writable: true });
  }

  function stubFetch() {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      blob: () => Promise.resolve(new Blob(['fake-image-bytes'], { type: 'image/jpeg' })),
    }));
  }

  it('disables the Share button when the entry has no photos', () => {
    setup('Some notes but nothing visual yet.');
    mockUseStopPhotos.mockReturnValue({
      photos: [],
      loading: false,
      upload: vi.fn(),
      remove: vi.fn(),
      getUrl: (path: string) => `https://example.test/${path}`,
    });

    render(<JournalEntryCard stop={stop} />);

    expect(screen.getByRole('button', { name: /share/i })).toBeDisabled();
  });

  it('hands the caption and photo to the OS share sheet when supported', async () => {
    setup('Great walk along the walls.');
    stubFetch();
    const shareSpy = vi.fn().mockResolvedValue(undefined);
    defineNavProp('share', shareSpy);
    defineNavProp('canShare', () => true);

    const user = userEvent.setup();
    render(<JournalEntryCard stop={stop} />);
    await user.click(screen.getByRole('button', { name: /share/i }));

    expect(shareSpy).toHaveBeenCalledTimes(1);
    const call = shareSpy.mock.calls[0][0];
    expect(call.title).toBe('Dubrovnik');
    expect(call.text).toContain('Great walk along the walls.');
    expect(call.files).toHaveLength(1);
    expect(call.files[0].name).toBe('dubrovnik-photo-1.jpg');
  });

  it('also copies the caption to the clipboard on a successful share — Instagram silently drops shared text', async () => {
    setup('Great walk along the walls.');
    stubFetch();
    defineNavProp('share', vi.fn().mockResolvedValue(undefined));
    defineNavProp('canShare', () => true);
    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);

    const user = userEvent.setup();
    render(<JournalEntryCard stop={stop} />);
    await user.click(screen.getByRole('button', { name: /share/i }));

    expect(writeTextSpy).toHaveBeenCalledTimes(1);
    expect(writeTextSpy.mock.calls[0][0]).toContain('Great walk along the walls.');
  });

  it('falls back to copying the caption and opening the photo when file sharing is unsupported', async () => {
    setup('Great walk along the walls.');
    stubFetch();
    defineNavProp('share', undefined);
    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    vi.spyOn(window, 'alert').mockImplementation(() => {});

    const user = userEvent.setup();
    render(<JournalEntryCard stop={stop} />);
    await user.click(screen.getByRole('button', { name: /share/i }));

    expect(writeTextSpy).toHaveBeenCalledTimes(1);
    expect(writeTextSpy.mock.calls[0][0]).toContain('Great walk along the walls.');
    expect(openSpy).toHaveBeenCalledWith('https://example.test/dubrovnik/1.jpg', '_blank');
  });
});

describe('JournalEntryCard Google Photos picker visibility', () => {
  it('stays hidden until VITE_GOOGLE_CLIENT_ID is configured', () => {
    setup('');
    render(<JournalEntryCard stop={stop} />);

    expect(screen.queryByRole('button', { name: /google photos/i })).not.toBeInTheDocument();
  });
});
