import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface BreadcrumbStep {
  icon: string;
  label: string;
  time: string;
  detail?: ReactNode;
  color?: 'primary' | 'secondary' | 'tertiary' | 'error';
}

interface BreadcrumbProps {
  steps: BreadcrumbStep[];
  className?: string;
}

const colorMap: Record<string, string> = {
  primary: 'text-primary',
  secondary: 'text-secondary',
  tertiary: 'text-tertiary',
  error: 'text-error',
};

export function Breadcrumb({ steps, className }: BreadcrumbProps) {
  return (
    <div className={cn('flex flex-col relative pl-6 mt-1', className)}>
      <div className="absolute left-2.5 top-2.5 bottom-2.5 w-0.5 bg-surface-container-highest" />
      {steps.map((step, i) => (
        <div key={i} className="relative flex flex-col pb-4 last:pb-0">
          <div className="absolute -left-6 top-1 w-5 h-5 rounded-full bg-surface-container-high flex items-center justify-center">
            <span className="text-12px mds">{step.icon}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span
              className={cn(
                'text-code-sm font-semibold',
                colorMap[step.color ?? 'primary']
              )}
            >
              {step.label}
            </span>
            <span className="text-code-sm text-outline">{step.time}</span>
          </div>
          {step.detail && (
            <p className="text-body-sm text-on-surface mt-0.5">
              {step.detail}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}