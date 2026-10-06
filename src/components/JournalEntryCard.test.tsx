import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
  mockUseAuth.mockReturnValue({ user: { id: 'user-1' }, isEditor: true });
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

  it('shows a short {{photo N}} token in the editor, not the raw UUID', async () => {
    setup('');
    const user = userEvent.setup();
    const { container } = render(<JournalEntryCard stop={stop} />);

    await user.click(screen.getByRole('button', { name: /edit/i }));
    await user.click(screen.getByTitle('Insert into text'));

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.value).toContain('{{photo 1}}');
    expect(textarea.value).not.toContain(photo.id);
  });

  it('shows existing saved content in short form, and saves it back out as real UUIDs', async () => {
    const save = vi.fn().mockResolvedValue({ error: null });
    mockUseAuth.mockReturnValue({ user: { id: 'user-1' }, isEditor: true });
    mockUseStopNotes.mockReturnValue({
      content: `Before.\n\n{{photo:${photo.id}}}\n\nAfter.`,
      loading: false,
      saving: false,
      save,
    });
    mockUseStopPhotos.mockReturnValue({
      photos: [photo],
      loading: false,
      upload: vi.fn(),
      remove: vi.fn(),
      getUrl: (path: string) => `https://example.test/${path}`,
    });
    const user = userEvent.setup();
    const { container } = render(<JournalEntryCard stop={stop} />);

    await user.click(screen.getByRole('button', { name: /edit/i }));
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Before.\n\n{{photo 1}}\n\nAfter.');

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(save).toHaveBeenCalledWith(`Before.\n\n{{photo:${photo.id}}}\n\nAfter.`);
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
    mockUseAuth.mockReturnValue({ user: { id: 'user-1' }, isEditor: true });
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
    // #t=0.1 + preload="metadata" is what gets iOS Safari to paint a first-frame thumbnail
    expect(video).toHaveAttribute('src', 'https://example.test/dubrovnik/clip.mp4#t=0.1');
    expect(video).toHaveAttribute('preload', 'metadata');
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

describe('JournalEntryCard reader vs editor', () => {
  function setupEmpty(isEditor: boolean) {
    mockUseAuth.mockReturnValue({ user: isEditor ? { id: 'user-1' } : null, isEditor });
    mockUseStopNotes.mockReturnValue({ content: '', loading: false, saving: false, save: vi.fn() });
    mockUseStopPhotos.mockReturnValue({ photos: [], loading: false, upload: vi.fn(), remove: vi.fn(), getUrl: (p: string) => p });
  }

  it('does not open an empty, editable box for a reader on a stop with no entry yet', () => {
    setupEmpty(false);
    render(<JournalEntryCard stop={stop} isCurrent onToggleVisited={vi.fn()} />);

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mark visited/i })).not.toBeInTheDocument();
    expect(screen.getByText(/check back soon/i)).toBeInTheDocument();
  });

  it('still starts an editor straight into writing on an empty stop', () => {
    setupEmpty(true);
    render(<JournalEntryCard stop={stop} isCurrent />);

    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });
});

describe('JournalEntryCard hero header and lightbox', () => {
  const mk = (id: string) => ({ ...photo, id, storage_path: `dubrovnik/${id}.jpg` });

  function setupTwo() {
    mockUseAuth.mockReturnValue({ user: null, isEditor: false });
    mockUseStopNotes.mockReturnValue({
      content: 'First paragraph.\n\n{{photo:p1}}\n\nSecond paragraph.\n\n{{photo:p2}}',
      loading: false, saving: false, save: vi.fn(),
    });
    // Upload order is the reverse of reading order on purpose.
    mockUseStopPhotos.mockReturnValue({
      photos: [mk('p2'), mk('p1')], loading: false, upload: vi.fn(), remove: vi.fn(),
      getUrl: (p: string) => `https://example.test/${p}`,
    });
  }

  it('promotes the first photo to the header without repeating it inline', () => {
    setupTwo();
    const { container } = render(<JournalEntryCard stop={stop} />);
    const srcs = [...container.querySelectorAll('img')].map(i => i.getAttribute('src'));
    expect(srcs.filter(s => /p1(\.w1000)?\.jpg$/.test(s ?? ''))).toHaveLength(1);
    expect(srcs.filter(s => /p2(\.w1000)?\.jpg$/.test(s ?? ''))).toHaveLength(1);
    expect(screen.getByRole('heading', { name: /dubrovnik/i })).toBeInTheDocument();
  });

  it('steps through photos in reading order with a counter, arrow keys and swipe', async () => {
    setupTwo();
    const user = userEvent.setup();
    render(<JournalEntryCard stop={stop} />);

    await user.click(screen.getAllByRole('button', { name: /open photo/i })[0]);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('1 / 2');
    expect(dialog.querySelector('img')?.getAttribute('src')).toMatch(/p1\.jpg$/);

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('dialog')).toHaveTextContent('2 / 2');
    expect(screen.getByRole('dialog').querySelector('img')?.getAttribute('src')).toMatch(/p2\.jpg$/);

    // Swipe right goes back
    const stage = screen.getByRole('dialog').querySelector('img')!.parentElement!;
    fireEvent.touchStart(stage, { touches: [{ clientX: 100 }] });
    fireEvent.touchEnd(stage, { changedTouches: [{ clientX: 220 }] });
    expect(screen.getByRole('dialog')).toHaveTextContent('1 / 2');

    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('JournalEntryCard send link', () => {
  it('copies a direct link to the entry for readers when there is no share sheet', async () => {
    mockUseAuth.mockReturnValue({ user: null, isEditor: false });
    mockUseStopNotes.mockReturnValue({ content: 'Hello.', loading: false, saving: false, save: vi.fn() });
    mockUseStopPhotos.mockReturnValue({ photos: [], loading: false, upload: vi.fn(), remove: vi.fn(), getUrl: (p: string) => p });
    // jsdom has no navigator.share; userEvent.setup() installs a clipboard stub we can read back.
    const user = userEvent.setup();
    render(<JournalEntryCard stop={stop} />);
    await user.click(screen.getByRole('button', { name: /send link/i }));

    expect(await navigator.clipboard.readText()).toMatch(/#dubrovnik$/);
    expect(await screen.findByText(/link copied/i)).toBeInTheDocument();
  });
});

describe('JournalEntryCard captions', () => {
  const capPhoto = (id: string, caption: string | null) => ({ ...photo, id, storage_path: `dubrovnik/${id}.jpg`, caption });

  it('shows captions under inline photos for readers', () => {
    mockUseAuth.mockReturnValue({ user: null, isEditor: false });
    mockUseStopNotes.mockReturnValue({ content: 'Intro.\n\n{{photo:a}}\n\nMore.\n\n{{photo:b}}', loading: false, saving: false, save: vi.fn() });
    mockUseStopPhotos.mockReturnValue({ photos: [capPhoto('a', null), capPhoto('b', 'Viv and the dolphins')], loading: false, upload: vi.fn(), remove: vi.fn(), setCaption: vi.fn(), getUrl: (p: string) => p });
    render(<JournalEntryCard stop={stop} />);
    expect(screen.getByText('Viv and the dolphins')).toBeInTheDocument();
  });

  it('lets an editor save a caption from the photo viewer without arrow keys flipping photos', async () => {
    const setCaption = vi.fn().mockResolvedValue({ error: null });
    mockUseAuth.mockReturnValue({ user: { id: 'user-1' }, isEditor: true });
    mockUseStopNotes.mockReturnValue({ content: 'Intro.\n\n{{photo:a}}\n\nMore.\n\n{{photo:b}}', loading: false, saving: false, save: vi.fn() });
    mockUseStopPhotos.mockReturnValue({ photos: [capPhoto('a', null), capPhoto('b', null)], loading: false, upload: vi.fn(), remove: vi.fn(), setCaption, getUrl: (p: string) => p });
    const user = userEvent.setup();
    render(<JournalEntryCard stop={stop} />);

    await user.click(screen.getAllByRole('button', { name: /open photo/i })[0]);
    const input = screen.getByRole('textbox', { name: /caption/i });
    await user.type(input, 'Sunrise{ArrowRight}');
    expect(screen.getByRole('dialog')).toHaveTextContent('1 / 2');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(setCaption).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), 'Sunrise');
  });
});

describe('JournalEntryCard save/load safety', () => {
  it('keeps the editor open with the draft when a save fails, and shows why', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'user-1' }, isEditor: true });
    const save = vi.fn().mockResolvedValue({ error: new Error('offline') });
    mockUseStopNotes.mockReturnValue({ content: 'Old text.', loading: false, saving: false, save, error: 'offline' });
    mockUseStopPhotos.mockReturnValue({ photos: [], loading: false, upload: vi.fn(), remove: vi.fn(), getUrl: (p: string) => p });
    const user = userEvent.setup();
    render(<JournalEntryCard stop={stop} />);

    await user.click(screen.getByRole('button', { name: /edit/i }));
    await user.type(screen.getByRole('textbox'), ' New words.');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(screen.getByRole('textbox')).toHaveValue('Old text. New words.');
    expect(screen.getByRole('alert')).toHaveTextContent(/not saved: offline/i);
  });

  it('never shows a failed load as an empty, editable entry', () => {
    mockUseAuth.mockReturnValue({ user: { id: 'user-1' }, isEditor: true });
    mockUseStopNotes.mockReturnValue({ content: '', loading: false, saving: false, save: vi.fn(), loadFailed: true, refetch: vi.fn() });
    mockUseStopPhotos.mockReturnValue({ photos: [], loading: false, upload: vi.fn(), remove: vi.fn(), getUrl: (p: string) => p });
    render(<JournalEntryCard stop={stop} isCurrent />);

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't load/i);
  });
});
