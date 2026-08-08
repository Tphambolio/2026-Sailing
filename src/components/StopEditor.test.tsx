import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StopEditor from './StopEditor';

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
