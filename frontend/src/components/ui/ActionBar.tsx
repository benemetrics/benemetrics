import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface ActionBarProps {
  children: ReactNode;
  className?: string;
}

export function ActionBar({ children, className }: ActionBarProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between mt-3 pt-2',
        className
      )}
    >
      {children}
    </div>
  );
}