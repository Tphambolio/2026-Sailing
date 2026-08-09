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

describe('StopEditor reposition on map', () => {
  it('shows a "pick on map" button only when editing an existing stop with the callback wired up', () => {
    render(<StopEditor stop={existingStop} countries={['Croatia']} onSave={vi.fn()} onCancel={vi.fn()} onPickLocation={vi.fn()} />);
    expect(screen.getByRole('button', { name: /pick new location on map/i })).toBeInTheDocument();
  });

  it('does not show the button when adding a new stop, even if onPickLocation were somehow passed', () => {
    render(<StopEditor stop={null} countries={['Croatia']} onSave={vi.fn()} onCancel={vi.fn()} onPickLocation={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /pick new location on map/i })).not.toBeInTheDocument();
  });

  it('calls onPickLocation when clicked, and reflects the pickingLocation state', async () => {
    const onPickLocation = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <StopEditor stop={existingStop} countries={['Croatia']} onSave={vi.fn()} onCancel={vi.fn()} onPickLocation={onPickLocation} />
    );

    await user.click(screen.getByRole('button', { name: /pick new location on map/i }));
    expect(onPickLocation).toHaveBeenCalledTimes(1);

    rerender(
      <StopEditor stop={existingStop} countries={['Croatia']} onSave={vi.fn()} onCancel={vi.fn()} onPickLocation={onPickLocation} pickingLocation />
    );
    expect(screen.getByRole('button', { name: /click the correct spot on the map/i })).toBeDisabled();
  });

  it('updates the Latitude/Longitude fields when the stop prop coordinates change (map click landing)', () => {
    const { rerender, container } = render(
      <StopEditor stop={existingStop} countries={['Croatia']} onSave={vi.fn()} onCancel={vi.fn()} onPickLocation={vi.fn()} />
    );
    const latInput = container.querySelector('input[placeholder="43.95"]') as HTMLInputElement;
    expect(latInput.value).toBe('43.0962');

    rerender(
      <StopEditor
        stop={{ ...existingStop, lat: 42.9611, lon: 17.135 }}
        countries={['Croatia']}
        onSave={vi.fn()}
        onCancel={vi.fn()}
        onPickLocation={vi.fn()}
      />
    );
    expect(latInput.value).toBe('42.9611');
  });
});

describe('StopEditor culture highlight', () => {
  it('pre-fills the existing culture highlight, editable directly', () => {
    const stopWithCulture = { ...existingStop, cultureHighlight: 'Rožat is a small village near Dubrovnik, Croatia.' };
    render(<StopEditor stop={stopWithCulture} countries={['Croatia']} onSave={vi.fn()} onCancel={vi.fn()} />);

    const field = screen.getByDisplayValue('Rožat is a small village near Dubrovnik, Croatia.');
    expect(field.tagName).toBe('TEXTAREA');
  });

  it('clearing the field and saving removes the culture highlight entirely', async () => {
    const stopWithCulture = { ...existingStop, cultureHighlight: 'Rožat is a small village near Dubrovnik, Croatia.' };
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<StopEditor stop={stopWithCulture} countries={['Croatia']} onSave={onSave} onCancel={vi.fn()} />);

    const field = screen.getByDisplayValue('Rožat is a small village near Dubrovnik, Croatia.');
    await user.clear(field);
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].cultureHighlight).toBeUndefined();
  });

  it('edits to the culture highlight are saved as typed', async () => {
    const stopWithCulture = { ...existingStop, cultureHighlight: 'Old blurb.' };
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<StopEditor stop={stopWithCulture} countries={['Croatia']} onSave={onSave} onCancel={vi.fn()} />);

    const field = screen.getByDisplayValue('Old blurb.');
    await user.clear(field);
    await user.type(field, 'New blurb.');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(onSave.mock.calls[0][0].cultureHighlight).toBe('New blurb.');
  });
});
