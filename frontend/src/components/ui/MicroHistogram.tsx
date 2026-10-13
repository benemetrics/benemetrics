import { cn } from '../../lib/utils';

interface MicroHistogramProps {
  bars: number[];
  color?: 'primary' | 'secondary' | 'error' | 'tertiary';
  className?: string;
}

const colorMap = {
  primary: 'bg-primary',
  secondary: 'bg-secondary',
  error: 'bg-error',
  tertiary: 'bg-tertiary',
};

export function MicroHistogram({ bars, color = 'primary', className }: MicroHistogramProps) {
  const max = Math.max(...bars, 1);
  return (
    <div className={cn('flex items-end gap-0.5', className)}>
      {bars.map((h, i) => (
        <div
          key={i}
          className={cn(
            'flex-1 rounded-xs',
            colorMap[color],
            h === max && 'shadow-[0_0_6px_rgba(76,215,246,0.5)]'
          )}
          style={{ height: `${(h / max) * 100}%` }}
        />
      ))}
    </div>
  );
}