import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import LazyEntry from './LazyEntry';
import type { Stop } from '../types';

const stop = { id: 1, key: 'paros', name: 'Paros', country: 'Greece', lat: 0, lon: 0, type: 'marina', arrival: '2026-09-19', departure: '2026-09-22', duration: '3 days', distanceToNext: 0, season: 'fall', phase: 'Greece' } as Stop;

describe('LazyEntry', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders an eager entry (current / linked stop) immediately', () => {
    render(<LazyEntry stop={stop} dateLine="19 Sep" eager><p>full entry</p></LazyEntry>);
    expect(screen.getByText('full entry')).toBeInTheDocument();
  });

  it('shows a light placeholder until the entry nears the viewport, then mounts it', () => {
    let trigger: (entries: { isIntersecting: boolean }[]) => void = () => {};
    vi.stubGlobal('IntersectionObserver', class {
      constructor(cb: typeof trigger) { trigger = cb; }
      observe() {}
      disconnect() {}
    });
    render(<LazyEntry stop={stop} dateLine="19 Sep → · Greece"><p>full entry</p></LazyEntry>);

    expect(screen.queryByText('full entry')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /paros/i })).toBeInTheDocument();

    act(() => trigger([{ isIntersecting: true }]));
    expect(screen.getByText('full entry')).toBeInTheDocument();
  });
});
