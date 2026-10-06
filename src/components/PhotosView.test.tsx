import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PhotosView from './PhotosView';
import type { Stop } from '../types';

const { rows } = vi.hoisted(() => ({
  rows: [
    { id: 'p1', stop_key: 'old', storage_path: 'old/1.jpg', caption: null, created_by: null, created_at: '2026-07-01' },
    { id: 'p2', stop_key: 'new', storage_path: 'new/2.jpg', caption: 'Quay at dusk', created_by: null, created_at: '2026-09-20' },
  ],
}));
vi.mock('../lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ order: () => Promise.resolve({ data: rows, error: null }) }) }) },
  getStopPhotoUrl: (p: string) => `https://x.test/${p}`,
}));

const s = (o: Partial<Stop>): Stop => ({ id: 1, key: 'k', name: 'N', country: 'Greece', lat: 0, lon: 0, type: 'marina', arrival: '2026-07-01', departure: '2026-07-02', duration: '1 day', distanceToNext: 0, season: 'summer', phase: 'Greece', ...o });

describe('PhotosView', () => {
  it('groups photos by stop, latest stop first, and opens an entry from the viewer', async () => {
    const onOpenEntry = vi.fn();
    const stops = [s({ key: 'old', name: 'Old Harbour', arrival: '2026-07-01' }), s({ key: 'new', name: 'New Bay', arrival: '2026-09-20' })];
    render(<PhotosView stops={stops} onOpenEntry={onOpenEntry} />);

    const headings = await screen.findAllByRole('heading', { level: 2 });
    expect(headings.map(h => h.textContent)).toEqual([expect.stringContaining('New Bay'), expect.stringContaining('Old Harbour')]);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /open photo from new bay: quay at dusk/i }));
    expect(screen.getByRole('dialog')).toHaveTextContent('1 / 2');
    expect(screen.getByRole('dialog')).toHaveTextContent('Quay at dusk');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('dialog')).toHaveTextContent('2 / 2');

    await user.click(screen.getByRole('button', { name: /old harbour — read the entry/i }));
    expect(onOpenEntry).toHaveBeenCalledWith(expect.objectContaining({ key: 'old' }));
  });
});
