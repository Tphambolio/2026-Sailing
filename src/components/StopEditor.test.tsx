import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StopEditor from './StopEditor';
import type { Stop } from '../types';

const existingStop: Partial<Stop> = {
  id: 23, key: 'scedro', name: 'Šćedro', country: 'Croatia', lat: 43.0962, lon: 16.708,
  type: 'anchorage', arrival: '2026-08-03', departure: '2026-08-04', duration: '1 day',
};

// The form's labels aren't wired to their inputs via htmlFor/id anywhere in this
// component, so getByLabelText won't resolve them — locate the date field by type instead.
function getDateInput(container: HTMLElement) {
  return container.querySelector('input[type="date"]') as HTMLInputElement;
}

describe('StopEditor actual date', () => {
  it('sets actualArrival/actualDeparture and visited when a date is filled in for a new stop', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<StopEditor stop={null} countries={['Croatia']} onSave={onSave} onCancel={vi.fn()} />);

    await user.type(screen.getByPlaceholderText('e.g., Kotor Bay'), 'Mljet (Prozura)');
    await user.type(screen.getByPlaceholderText('43.95'), '42.731');
    await user.type(screen.getByPlaceholderText('15.45'), '17.649');
    // Duration slider defaults to 3 days — left as-is here; actualDeparture below
    // is asserted against that default rather than fighting a range input in jsdom.

    const dateInput = getDateInput(container);
    await user.type(dateInput, '2026-08-07');

    await user.click(screen.getByRole('button', { name: 'Add Stop' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0];
    expect(saved.actualArrival).toBe('2026-08-07');
    expect(saved.actualDeparture).toBe('2026-08-10'); // arrival + default 3-day duration
    expect(saved.visited).toBe(true);
  });

  it('omits actualArrival/actualDeparture/visited when the date is left blank', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<StopEditor stop={null} countries={['Croatia']} onSave={onSave} onCancel={vi.fn()} />);

    await user.type(screen.getByPlaceholderText('e.g., Kotor Bay'), 'Somewhere');
    await user.type(screen.getByPlaceholderText('43.95'), '42.7');
    await user.type(screen.getByPlaceholderText('15.45'), '17.6');
    await user.click(screen.getByRole('button', { name: 'Add Stop' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0];
    expect(saved.actualArrival).toBeUndefined();
    expect(saved.actualDeparture).toBeUndefined();
    expect(saved.visited).toBeUndefined();
  });
});

describe('StopEditor fields not editable here are preserved on save', () => {
  it('leaves cultureHighlight/marinaName/marinaUrl unchanged even though this form has no inputs for them', async () => {
    // This form has no controls for these fields, so the save payload must carry
    // their original values through unchanged (via the `...stop` spread in
    // handleSave) rather than defaulting them to undefined and wiping what's saved.
    const stopWithExtras = {
      ...existingStop,
      cultureHighlight: 'Rožat is a small village near Dubrovnik, Croatia.',
      marinaName: 'ACI Marina',
      marinaUrl: 'https://example.com',
    };
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<StopEditor stop={stopWithExtras} countries={['Croatia']} onSave={onSave} onCancel={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0];
    expect(saved.cultureHighlight).toBe('Rožat is a small village near Dubrovnik, Croatia.');
    expect(saved.marinaName).toBe('ACI Marina');
    expect(saved.marinaUrl).toBe('https://example.com');
  });
});
