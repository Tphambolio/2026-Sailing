import { useState } from 'react';
import type { Stop, Phase } from '../../types';
import { CalendarHeader } from './CalendarHeader';
import { CalendarGrid } from './CalendarGrid';
import { getTripMonths } from './calendarUtils';

interface CalendarViewProps {
  stops: Stop[];
  phases: Phase[];
  selectedStop: Stop | null;
  onStopSelect: (stop: Stop | null) => void;
}

export function CalendarView({
  stops,
  phases,
  selectedStop,
  onStopSelect,
}: CalendarViewProps) {
  // Start at July 2026 (first month of trip)
  const [currentYear, setCurrentYear] = useState(2026);
  const [currentMonth, setCurrentMonth] = useState(6); // July = 6

  const tripMonths = getTripMonths();

  const navigateMonth = (direction: 'prev' | 'next') => {
    const currentIndex = tripMonths.findIndex(
      (m) => m.year === currentYear && m.month === currentMonth
    );

    if (direction === 'prev' && currentIndex > 0) {
      const prev = tripMonths[currentIndex - 1];
      setCurrentYear(prev.year);
      setCurrentMonth(prev.month);
    } else if (direction === 'next' && currentIndex < tripMonths.length - 1) {
      const next = tripMonths[currentIndex + 1];
      setCurrentYear(next.year);
      setCurrentMonth(next.month);
    }
  };

  const handleMonthSelect = (year: number, month: number) => {
    setCurrentYear(year);
    setCurrentMonth(month);
  };

  const handleStopSelect = (stop: Stop) => {
    onStopSelect(stop);
  };

  // Calculate some stats for the legend
  const countriesInView = [...new Set(stops.map((s) => s.country))];

  return (
    <div className="h-full flex flex-col bg-slate-900 p-2 md:p-4">
      {/* Header with navigation */}
      <CalendarHeader
        year={currentYear}
        month={currentMonth}
        onPrevMonth={() => navigateMonth('prev')}
        onNextMonth={() => navigateMonth('next')}
        onMonthSelect={handleMonthSelect}
      />

      {/* Calendar grid */}
      <div className="flex-1 overflow-auto">
        <CalendarGrid
          year={currentYear}
          month={currentMonth}
          stops={stops}
          phases={phases}
          selectedStop={selectedStop}
          onStopSelect={handleStopSelect}
        />
      </div>

      {/* Legend */}
      <div className="mt-2 md:mt-4 flex flex-wrap gap-2 md:gap-3 justify-center">
        {phases
          .filter((p) => countriesInView.includes(p.name))
          .map((phase) => (
            <div key={phase.id} className="flex items-center gap-1 md:gap-2">
              <div
                className="w-3 h-3 md:w-4 md:h-4 rounded"
                style={{ backgroundColor: phase.color }}
              />
              <span className="text-xs md:text-sm text-slate-400">{phase.name}</span>
            </div>
          ))}
      </div>

      {/* Selected stop info */}
      {selectedStop && (
        <div className="mt-2 md:mt-4 p-3 md:p-4 bg-slate-800 rounded-lg border border-slate-700">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-white text-sm md:text-base truncate">{selectedStop.name}</h3>
              <p className="text-xs md:text-sm text-slate-400">{selectedStop.country}</p>
            </div>
            <button
              onClick={() => onStopSelect(null)}
              className="text-slate-500 hover:text-white ml-2 flex-shrink-0"
            >
              &times;
            </button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1 md:gap-2 text-xs md:text-sm">
            <div className="text-slate-400">
              <span className="text-slate-500">Arr:</span>{' '}
              {new Date(selectedStop.arrival).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              })}
            </div>
            <div className="text-slate-400">
              <span className="text-slate-500">Dep:</span>{' '}
              {new Date(selectedStop.departure).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              })}
            </div>
            <div className="text-slate-400">
              <span className="text-slate-500">Stay:</span> {selectedStop.duration}
            </div>
            <div className="text-slate-400">
              {selectedStop.type === 'marina' ? '⛵ Marina' : '⚓ Anchorage'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
