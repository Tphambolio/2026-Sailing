import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RouteSoFarCard from './RouteSoFarCard';
import type { Stop } from '../types';

vi.mock('../data/medCoastline.json', () => ({ default: { polygons: [] } }));

const s = (o: Partial<Stop>): Stop => ({ id: 1, key: 'k', name: 'N', country: 'Croatia', lat: 43, lon: 16, type: 'anchorage', arrival: '2026-06-19', departure: '2026-06-20', duration: '1 day', distanceToNext: 0, season: 'summer', phase: 'Croatia', ...o });

describe('RouteSoFarCard', () => {
  it('summarises only what was actually sailed and links to the map', async () => {
    const onOpenMap = vi.fn();
    const stops = [
      s({ key: 'a', lat: 43.7, lon: 15.9, visited: true, actualArrival: '2026-06-19' }),
      s({ key: 'b', lat: 37.08, lon: 25.15, country: 'Greece', visited: true }),
      s({ key: 'c', lat: 36.8, lon: 27.4, country: 'Turkey', visited: false }),
    ];
    render(<RouteSoFarCard stops={stops} onOpenMap={onOpenMap} />);

    // 2 visited stops in 2 countries — the unvisited Turkey stop isn't counted
    expect(screen.getAllByText('2', { selector: 'dd' })).toHaveLength(2);
    expect(screen.getByText('countries', { selector: 'dd' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /view on map/i }));
    expect(onOpenMap).toHaveBeenCalled();
  });

  it('renders nothing before there is a track', () => {
    const { container } = render(<RouteSoFarCard stops={[s({ visited: true })]} onOpenMap={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
