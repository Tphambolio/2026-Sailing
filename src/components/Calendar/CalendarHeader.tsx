import { formatMonthYear, getTripMonths } from './calendarUtils';

interface CalendarHeaderProps {
  year: number;
  month: number;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onMonthSelect: (year: number, month: number) => void;
}

export function CalendarHeader({
  year,
  month,
  onPrevMonth,
  onNextMonth,
  onMonthSelect,
}: CalendarHeaderProps) {
  const tripMonths = getTripMonths();

  // Check if we can go prev/next
  const currentIndex = tripMonths.findIndex((m) => m.year === year && m.month === month);
  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < tripMonths.length - 1;

  return (
    <div className="flex items-center justify-between mb-2 md:mb-4 px-1 md:px-2">
      {/* Navigation */}
      <div className="flex items-center gap-1 md:gap-2">
        <button
          onClick={onPrevMonth}
          disabled={!canGoPrev}
          className="p-1.5 md:p-2 rounded-lg hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <span className="text-slate-300 text-base md:text-lg">◀</span>
        </button>

        <h2 className="text-base md:text-xl font-semibold text-white min-w-[120px] md:min-w-[180px] text-center">
          {formatMonthYear(year, month)}
        </h2>

        <button
          onClick={onNextMonth}
          disabled={!canGoNext}
          className="p-1.5 md:p-2 rounded-lg hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <span className="text-slate-300 text-base md:text-lg">▶</span>
        </button>
      </div>

      {/* Month dropdown */}
      <select
        value={`${year}-${month}`}
        onChange={(e) => {
          const [y, m] = e.target.value.split('-').map(Number);
          onMonthSelect(y, m);
        }}
        className="bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 md:px-3 md:py-2 text-xs md:text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-cyan-500"
      >
        {tripMonths.map(({ year: y, month: m }) => (
          <option key={`${y}-${m}`} value={`${y}-${m}`}>
            {formatMonthYear(y, m)}
          </option>
        ))}
      </select>
    </div>
  );
}
