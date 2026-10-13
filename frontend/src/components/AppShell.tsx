import type { ReactNode } from 'react';

interface AppShellProps {
  children: ReactNode;
  nav?: ReactNode;
  className?: string;
}

export function AppShell({ children, nav, className }: AppShellProps) {
  return (
    <div className={className}>
      <main className="pb-safe pt-safe">
        {children}
      </main>
      {nav}
    </div>
  );
}