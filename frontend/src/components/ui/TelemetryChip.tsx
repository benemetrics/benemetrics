import { cn } from '../../lib/utils';

export type TelemetryChipColor = 'primary' | 'secondary' | 'tertiary' | 'error' | 'warning';

interface TelemetryChipProps {
  label: string;
  value?: string;
  color?: TelemetryChipColor;
  className?: string;
}

const colorMap: Record<TelemetryChipColor, { bg: string; text: string }> = {
  primary: { bg: 'bg-primary', text: 'text-on-primary' },
  secondary: { bg: 'bg-secondary', text: 'text-on-secondary' },
  tertiary: { bg: 'bg-tertiary', text: 'text-on-tertiary' },
  error: { bg: 'bg-error-container', text: 'text-on-error-container' },
  warning: { bg: 'bg-surface-container-highest', text: 'text-tertiary-fixed' },
};

export function TelemetryChip({
  label,
  value,
  color = 'primary',
  className,
}: TelemetryChipProps) {
  const cfg = colorMap[color];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-code-sm font-semibold',
        cfg.bg,
        cfg.text,
        className
      )}
    >
      <span className="material-symbols-outlined mds text-[12px]">
        {color === 'secondary' ? 'sell' : color === 'tertiary' ? 'dns' : color === 'error' ? 'bug_report' : 'timer'}
      </span>
      {label}
      {value && (
        <span className="ml-1 text-outline">{value}</span>
      )}
    </span>
  );
}