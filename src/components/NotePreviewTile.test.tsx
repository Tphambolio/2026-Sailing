import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NotePreviewTile from './NotePreviewTile';
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

function setup({
  content = '',
  photos = [] as { id: string; storage_path: string }[],
  loading = false,
  signedIn = true,
}) {
  mockUseAuth.mockReturnValue({ user: signedIn ? { id: 'user-1' } : null });
  mockUseStopNotes.mockReturnValue({ content, loading });
  mockUseStopPhotos.mockReturnValue({
    photos,
    loading,
    getUrl: (path: string) => `https://example.test/${path}`,
  });
}

describe('NotePreviewTile', () => {
  it('renders nothing while still loading, to avoid a flash of "no notes yet"', () => {
    setup({ content: '', loading: true });
    const { container } = render(<NotePreviewTile stop={stop} onExpand={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when empty and the viewer is signed out (nothing they could do about it)', () => {
    setup({ content: '', signedIn: false });
    const { container } = render(<NotePreviewTile stop={stop} onExpand={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows an "add one" prompt when empty and signed in', () => {
    setup({ content: '', signedIn: true });
    const onExpand = vi.fn();
    render(<NotePreviewTile stop={stop} onExpand={onExpand} />);

    fireEvent.click(screen.getByText(/no journal entry yet/i));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it('shows a truncated snippet of the note text and calls onExpand on click', () => {
    setup({ content: 'Great walk along the old town walls this morning.' });
    const onExpand = vi.fn();
    render(<NotePreviewTile stop={stop} onExpand={onExpand} />);

    expect(screen.getByText(/Great walk along the old town walls/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/read full entry/i));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it('truncates long content with an ellipsis rather than showing the whole entry', () => {
    const longText = 'A'.repeat(300);
    setup({ content: longText });
    render(<NotePreviewTile stop={stop} onExpand={vi.fn()} />);

    const shown = screen.getByText(/^A+…$/);
    expect(shown.textContent!.length).toBeLessThan(longText.length);
    expect(shown.textContent!.endsWith('…')).toBe(true);
  });

  it('strips {{photo:ID}} tokens out of the text snippet', () => {
    setup({ content: 'Before the photo.\n\n{{photo:abc-123}}\n\nAfter the photo.' });
    render(<NotePreviewTile stop={stop} onExpand={vi.fn()} />);

    expect(screen.getByText(/Before the photo\. After the photo\./)).toBeInTheDocument();
    expect(screen.queryByText(/\{\{photo:/)).not.toBeInTheDocument();
  });

  it('shows a thumbnail for a non-video first photo and the photo count', () => {
    setup({
      content: 'Some notes.',
      photos: [
        { id: 'p1', storage_path: 'dubrovnik/1.jpg' },
        { id: 'p2', storage_path: 'dubrovnik/2.jpg' },
      ],
    });
    const { container } = render(<NotePreviewTile stop={stop} onExpand={vi.fn()} />);

    // Decorative thumbnail — alt="" intentionally, so it's role="presentation"
    // rather than role="img"; query the DOM directly instead of by role.
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', 'https://example.test/dubrovnik/1.jpg');
    expect(screen.getByText(/2 photos/)).toBeInTheDocument();
  });

  it('does not try to render a video file as an <img> thumbnail', () => {
    setup({
      content: 'Video from today.',
      photos: [{ id: 'v1', storage_path: 'dubrovnik/clip.mp4' }],
    });
    const { container } = render(<NotePreviewTile stop={stop} onExpand={vi.fn()} />);

    expect(container.querySelector('img')).not.toBeInTheDocument();
    expect(screen.getByText(/1 photo\b/)).toBeInTheDocument();
  });

  it('shows a photo-only preview (no text) when there is no note text yet', () => {
    setup({ content: '', photos: [{ id: 'p1', storage_path: 'dubrovnik/1.jpg' }] });
    const { container } = render(<NotePreviewTile stop={stop} onExpand={vi.fn()} />);

    expect(container.querySelector('img')).toBeInTheDocument();
    expect(screen.getByText(/read full entry/i)).toBeInTheDocument();
    expect(screen.queryByText(/no journal entry yet/i)).not.toBeInTheDocument();
  });
});
