import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { MobileNavBar } from './MobileNavBar';
import { cn } from '../lib/utils';

const MOBILE_LINKS = [
  { path: '/issues', label: 'Issues', icon: 'bug_report' },
  { path: '/performance', label: 'Perf', icon: 'speed' },
  { path: '/replays', label: 'Replays', icon: 'play_circle' },
  { path: '/admin', label: 'Admin', icon: 'admin_panel_settings' },
];

interface PageShellProps {
  children: ReactNode;
  // Desktop-only header content rendered on the left (e.g. a search field).
  search?: ReactNode;
  // Actions rendered in the desktop header (right side) and the mobile top bar.
  actions?: ReactNode;
  // Constrain content to a readable column on wide screens (mobile-first pages).
  narrow?: boolean;
}

/**
 * Responsive page chrome shared by every screen:
 *  - >= lg: fixed left sidebar, optional fixed header, full-width content
 *  - < lg: fixed top app bar, fixed bottom navigation, stacked content
 */
export function PageShell({ children, search, actions, narrow }: PageShellProps) {
  const hasHeader = Boolean(search || actions);

  return (
    <div className="bg-background font-body-md text-on-surface antialiased min-h-screen selection:bg-primary-container selection:text-on-primary-container">
      <Sidebar />

      {/* Mobile top app bar */}
      <div className="lg:hidden fixed top-0 inset-x-0 z-40 h-14 bg-surface/80 backdrop-blur-xl flex items-center justify-between px-4 shadow-[0_1px_8px_rgba(0,0,0,0.2)]">
        <div className="flex items-center gap-space-sm min-w-0">
          <div className="w-7 h-7 rounded-xl bg-primary-container flex items-center justify-center text-on-primary-container shrink-0">
            <span className="material-symbols-outlined text-[18px]">radar</span>
          </div>
          <span className="font-headline-sm text-headline-sm text-on-surface tracking-tight font-bold truncate">Benemetrics</span>
        </div>
        {actions && <div className="flex items-center gap-space-xs shrink-0">{actions}</div>}
      </div>

      {/* Desktop header */}
      {hasHeader && (
        <header className="hidden lg:flex fixed top-0 left-64 right-0 h-14 bg-surface/80 backdrop-blur-xl z-40 items-center justify-between px-margin-tablet shadow-[0_1px_8px_rgba(0,0,0,0.06)]">
          <div className="flex items-center gap-space-lg flex-1 min-w-0">{search}</div>
          {actions && <div className="flex items-center gap-space-lg shrink-0">{actions}</div>}
        </header>
      )}

      <div className={cn('lg:pl-64', hasHeader ? 'pt-14' : 'pt-14 lg:pt-0')}>
        <main className={cn('w-full pb-24 lg:pb-10', narrow ? 'max-w-3xl mx-auto px-4 pt-4' : 'px-4 lg:px-margin-tablet pt-4')}>
          {children}
        </main>
      </div>

      <MobileNavBar links={MOBILE_LINKS} className="lg:hidden" />
    </div>
  );
}
