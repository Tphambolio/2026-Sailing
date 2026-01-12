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
    <div className="flex items-center justify-between mb-4 px-2">
      {/* Navigation */}
      <div className="flex items-center gap-2">
        <button
          onClick={onPrevMonth}
          disabled={!canGoPrev}
          className="p-2 rounded-lg hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <span className="text-slate-300 text-lg">◀</span>
        </button>

        <h2 className="text-xl font-semibold text-white min-w-[180px] text-center">
          {formatMonthYear(year, month)}
        </h2>

        <button
          onClick={onNextMonth}
          disabled={!canGoNext}
          className="p-2 rounded-lg hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <span className="text-slate-300 text-lg">▶</span>
        </button>
      </div>

      {/* Month dropdown */}
      <select
        value={`${year}-${month}`}
        onChange={(e) => {
          const [y, m] = e.target.value.split('-').map(Number);
          onMonthSelect(y, m);
        }}
        className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-cyan-500"
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
