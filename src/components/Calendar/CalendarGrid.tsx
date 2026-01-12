import type { Stop, Phase } from '../../types';
import { StayBlock } from './StayBlock';
import {
  getCalendarDays,
  getStopsInMonth,
  getStaySegments,
  isToday,
  DAY_NAMES,
} from './calendarUtils';

interface CalendarGridProps {
  year: number;
  month: number;
  stops: Stop[];
  phases: Phase[];
  selectedStop: Stop | null;
  onStopSelect: (stop: Stop) => void;
}

export function CalendarGrid({
  year,
  month,
  stops,
  phases,
  selectedStop,
  onStopSelect,
}: CalendarGridProps) {
  const calendarDays = getCalendarDays(year, month);
  const stopsInMonth = getStopsInMonth(stops, year, month);

  // Get all segments for all stops in this month
  const allSegments = stopsInMonth.flatMap((stop) =>
    getStaySegments(stop, year, month, calendarDays)
  );

  // Group segments by row
  const segmentsByRow: Record<number, typeof allSegments> = {};
  allSegments.forEach((segment) => {
    if (!segmentsByRow[segment.rowIndex]) {
      segmentsByRow[segment.rowIndex] = [];
    }
    segmentsByRow[segment.rowIndex].push(segment);
  });

  const weeks = Math.ceil(calendarDays.length / 7);

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
      {/* Day names header */}
      <div className="grid grid-cols-7 bg-slate-700/50">
        {DAY_NAMES.map((day) => (
          <div
            key={day}
            className="py-2 text-center text-xs font-medium text-slate-400 uppercase tracking-wider"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar weeks */}
      {Array.from({ length: weeks }).map((_, weekIndex) => {
        const weekDays = calendarDays.slice(weekIndex * 7, (weekIndex + 1) * 7);
        const rowSegments = segmentsByRow[weekIndex] || [];

        return (
          <div key={weekIndex} className="relative">
            {/* Day cells */}
            <div className="grid grid-cols-7 border-t border-slate-700">
              {weekDays.map((day, dayIndex) => {
                const isCurrentMonth = day.getMonth() === month;
                const isTodayDate = isToday(day);

                return (
                  <div
                    key={dayIndex}
                    className={`min-h-[80px] p-2 border-r border-slate-700 last:border-r-0 ${
                      isCurrentMonth ? 'bg-slate-800' : 'bg-slate-900/50'
                    }`}
                  >
                    <span
                      className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-sm ${
                        isTodayDate
                          ? 'bg-cyan-500 text-white font-bold'
                          : isCurrentMonth
                          ? 'text-slate-300'
                          : 'text-slate-600'
                      }`}
                    >
                      {day.getDate()}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Stay blocks overlay for this row */}
            <div className="absolute inset-x-0 top-10 bottom-2 pointer-events-none">
              <div className="relative h-full pointer-events-auto">
                {rowSegments.map((segment, idx) => (
                  <StayBlock
                    key={`${segment.stop.id}-${idx}`}
                    segment={segment}
                    phases={phases}
                    onClick={() => onStopSelect(segment.stop)}
                    isSelected={selectedStop?.id === segment.stop.id}
                  />
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
