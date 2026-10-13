import { cn } from '../../lib/utils';

export type StatusLevel = 'critical' | 'error' | 'warning' | 'recovered' | 'resolved' | 'active';

interface StatusPillProps {
  level: StatusLevel;
  label?: string;
  pulse?: boolean;
  className?: string;
}

const levelConfig: Record<StatusLevel, { bg: string; text: string; dot: string }> = {
  critical: {
    bg: 'bg-error-container',
    text: 'text-on-error-container',
    dot: 'bg-error',
  },
  error: {
    bg: 'bg-error-container',
    text: 'text-on-error-container',
    dot: 'bg-error',
  },
  warning: {
    bg: 'bg-surface-container-highest',
    text: 'text-tertiary-fixed',
    dot: 'bg-tertiary',
  },
  recovered: {
    bg: 'bg-surface-container-highest',
    text: 'text-secondary',
    dot: 'bg-secondary',
  },
  resolved: {
    bg: 'bg-surface-container-highest',
    text: 'text-secondary',
    dot: 'bg-secondary',
  },
  active: {
    bg: 'bg-surface-container-highest',
    text: 'text-primary',
    dot: 'bg-primary',
  },
};

export function StatusPill({ level, label, pulse, className }: StatusPillProps) {
  const cfg = levelConfig[level];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-code-sm font-semibold',
        cfg.bg,
        cfg.text,
        className
      )}
    >
      <span
        className={cn(
          'w-1.5 h-1.5 rounded-full',
          cfg.dot,
          pulse && 'animate-ping'
        )}
      />
      {label ?? level.toUpperCase()}
    </span>
  );
}