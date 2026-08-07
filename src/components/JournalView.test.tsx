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
// this test checks (whether a signed-out visitor can find the sign-in control at all),
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

describe('JournalView sign-in visibility', () => {
  it('offers a sign-in control for a signed-out visitor even when entries already exist', () => {
    mockUseAuth.mockReturnValue({ user: null, signInWithProvider: vi.fn() });
    // At least one stop already has content — the trip is underway, not empty.
    mockUseJournalEntryKeys.mockReturnValue({ keys: new Set(['dubrovnik']), loading: false, refetch: vi.fn() });

    render(<JournalView stops={stops} />);

    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('does not show a sign-in control once signed in', () => {
    mockUseAuth.mockReturnValue({ user: { id: 'user-1' }, signInWithProvider: vi.fn() });
    mockUseJournalEntryKeys.mockReturnValue({ keys: new Set(['dubrovnik']), loading: false, refetch: vi.fn() });

    render(<JournalView stops={stops} />);

    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument();
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
    mockUseAuth.mockReturnValue({ user: { id: 'user-1' }, signInWithProvider: vi.fn() });
    // sibenik, split, and dubrovnik have real posts; kotor is a future stop with nothing written yet.
    mockUseJournalEntryKeys.mockReturnValue({ keys: new Set(['sibenik', 'split', 'dubrovnik']), loading: false, refetch: vi.fn() });

    const { container } = render(
      <JournalView stops={orderingStops} currentStop={orderingStops.find(s => s.key === 'dubrovnik') ?? null} />
    );

    const ids = Array.from(container.querySelectorAll('[id^="journal-"]')).map(el => el.id);
    expect(ids).toEqual(['journal-dubrovnik', 'journal-split', 'journal-sibenik', 'journal-kotor']);
  });
});
