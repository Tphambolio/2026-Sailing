import type { StaySegment } from './calendarUtils';
import type { Phase } from '../../types';
import { getCountryColor } from './calendarUtils';

interface StayBlockProps {
  segment: StaySegment;
  phases: Phase[];
  onClick: () => void;
  isSelected: boolean;
}

export function StayBlock({ segment, phases, onClick, isSelected }: StayBlockProps) {
  const { stop, startCol, spanDays, isStart, isEnd } = segment;
  const color = getCountryColor(stop.country, phases);

  // Calculate width based on span (each day is ~14.28% of row)
  const widthPercent = (spanDays / 7) * 100;
  const leftPercent = (startCol / 7) * 100;

  // Rounded corners based on start/end
  const borderRadius = `${isStart ? '4px' : '0'} ${isEnd ? '4px' : '0'} ${isEnd ? '4px' : '0'} ${isStart ? '4px' : '0'}`;

  return (
    <div
      onClick={onClick}
      className={`absolute h-4 md:h-6 cursor-pointer transition-all hover:brightness-110 hover:z-10 ${
        isSelected ? 'ring-2 ring-white ring-offset-1 ring-offset-slate-900 z-10' : ''
      }`}
      style={{
        left: `${leftPercent}%`,
        width: `${widthPercent}%`,
        backgroundColor: color,
        borderRadius,
        top: '50%',
        transform: 'translateY(-50%)',
      }}
      title={`${stop.name}, ${stop.country} (${stop.duration})`}
    >
      {/* Show name only if there's enough space (3+ days) */}
      {spanDays >= 3 && (
        <span className="absolute inset-0 flex items-center px-1 md:px-2 text-[10px] md:text-xs font-medium text-white truncate">
          {stop.name}
        </span>
      )}

      {/* Show emoji indicator for type */}
      {spanDays < 3 && (
        <span className="absolute inset-0 flex items-center justify-center text-[10px] md:text-xs">
          {stop.type === 'marina' ? '⛵' : '⚓'}
        </span>
      )}
    </div>
  );
}
