import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import JournalView from './JournalView';
import type { Stop } from '../types';

const { mockUseAuth, mockUseJournalEntryKeys } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockUseJournalEntryKeys: vi.fn(),
}));

vi.mock('../context/AuthContext', () => ({ useAuth: mockUseAuth }));
vi.mock('../hooks/useJournalEntries', () => ({ useJournalEntryKeys: mockUseJournalEntryKeys }));
// JournalEntryCard pulls in useStopNotes/useStopPhotos/Supabase — irrelevant to what
// these tests check (which stops a reader vs an editor sees),
// so it's stubbed out.
vi.mock('./JournalEntryCard', () => ({ default: () => <div data-testid="journal-entry-card" /> }));

const stops: Stop[] = [
  {
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
  },
];

// Signing in now happens from the header's 👤 button (visible at every width),
// so the journal itself no longer carries a "Sign in to write" link — family
// readers can't write anyway. What matters here is that readers get a clean,
// read-only feed and only editors see write-a-post placeholders.
describe('JournalView reader vs editor', () => {
  const twoStops: Stop[] = [stops[0], { ...stops[0], id: 2, key: 'kotor', name: 'Kotor', country: 'Montenegro' }];

  it('shows a reader only stops that have content, with no write placeholders or sign-in prompt', async () => {
    mockUseAuth.mockReturnValue({ user: null, isEditor: false });
    mockUseJournalEntryKeys.mockReturnValue({ keys: new Set(['dubrovnik']), loading: false, refetch: vi.fn() });

    render(<JournalView stops={twoStops} />);

    expect(await screen.findAllByTestId('journal-entry-card')).toHaveLength(1);
    expect(screen.queryByText(/write a post/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument();
  });

  it('treats a signed-in non-editor as a reader', () => {
    mockUseAuth.mockReturnValue({ user: { id: 'friend' }, isEditor: false });
    mockUseJournalEntryKeys.mockReturnValue({ keys: new Set(['dubrovnik']), loading: false, refetch: vi.fn() });

    render(<JournalView stops={twoStops} />);

    expect(screen.queryByText(/write a post/i)).not.toBeInTheDocument();
  });

  it('shows an editor a write-a-post placeholder for stops without content', () => {
    mockUseAuth.mockReturnValue({ user: { id: 'user-1' }, isEditor: true });
    mockUseJournalEntryKeys.mockReturnValue({ keys: new Set(['dubrovnik']), loading: false, refetch: vi.fn() });

    render(<JournalView stops={twoStops} />);

    expect(screen.getByText(/write a post/i)).toBeInTheDocument();
  });
});

function orderingStop(overrides: Partial<Stop>): Stop {
  return { ...stops[0], ...overrides };
}

const orderingStops: Stop[] = [
  orderingStop({ id: 1, key: 'sibenik', name: 'Sibenik', arrival: '2026-07-01', departure: '2026-07-03' }),
  orderingStop({ id: 2, key: 'split', name: 'Split', arrival: '2026-07-10', departure: '2026-07-12' }),
  orderingStop({ id: 3, key: 'dubrovnik', name: 'Dubrovnik', arrival: '2026-08-10', departure: '2026-08-12' }),
  orderingStop({ id: 4, key: 'kotor', name: 'Kotor', arrival: '2026-09-01', departure: '2026-09-03' }),
];

describe('JournalView feed ordering', () => {
  it('pins the current stop to the top, orders written posts newest-first, and puts unwritten future stops last', () => {
    mockUseAuth.mockReturnValue({ user: { id: 'user-1' }, isEditor: true, signInWithProvider: vi.fn() });
    // sibenik, split, and dubrovnik have real posts; kotor is a future stop with nothing written yet.
    mockUseJournalEntryKeys.mockReturnValue({ keys: new Set(['sibenik', 'split', 'dubrovnik']), loading: false, refetch: vi.fn() });

    const { container } = render(
      <JournalView stops={orderingStops} currentStop={orderingStops.find(s => s.key === 'dubrovnik') ?? null} />
    );

    const ids = Array.from(container.querySelectorAll('[id^="journal-"]')).map(el => el.id);
    expect(ids).toEqual(['journal-dubrovnik', 'journal-split', 'journal-sibenik', 'journal-kotor']);
  });
});

describe('JournalView keeps focused entries open (unsaved drafts)', () => {
  it('does not unmount a focused entry when focus moves to another stop', async () => {
    const a = { ...stops[0], key: 'a', name: 'Stop A' };
    const b = { ...stops[0], id: 2, key: 'b', name: 'Stop B' };
    mockUseAuth.mockReturnValue({ user: { id: 'user-1' }, isEditor: true });
    mockUseJournalEntryKeys.mockReturnValue({ keys: new Set<string>(), loading: false, refetch: vi.fn() }); // neither has content yet

    const { rerender } = render(<JournalView stops={[a, b]} focusStop={a} />);
    expect(await screen.findAllByTestId('journal-entry-card')).toHaveLength(1);

    rerender(<JournalView stops={[a, b]} focusStop={b} />);
    // A (possibly holding a draft) stays mounted alongside the newly focused B
    expect(await screen.findAllByTestId('journal-entry-card')).toHaveLength(2);
  });
});
