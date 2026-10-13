import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '../lib/utils';
import { checkHealth } from '../lib/api';

export const SIDEBAR_LINKS = [
  { path: '/issues', icon: 'error_outline', label: 'Issues' },
  { path: '/performance', icon: 'speed', label: 'Performance & APM' },
  { path: '/tracing', icon: 'account_tree', label: 'Distributed Tracing' },
  { path: '/replays', icon: 'slow_motion_video', label: 'Session Replays' },
  { path: '/setup', icon: 'integration_instructions', label: 'Setup & SDK' },
  { path: '/admin', icon: 'admin_panel_settings', label: 'Admin' },
];

// Fixed left sidebar shared across admin panel pages.
export function Sidebar() {
  const location = useLocation();
  const [health, setHealth] = useState<{ status: string; eventsStored: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await checkHealth();
        if (!cancelled && res?.data) setHealth(res.data);
      } catch {
        // keep last known health on fetch failure
      }
    };
    load();
    const interval = setInterval(load, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <aside className="fixed left-0 top-0 h-full w-64 bg-surface-container-lowest z-50 flex flex-col justify-between shadow-[0_1px_8px_rgba(0,0,0,0.2)]">
      <div className="flex flex-col">
        <div className="h-14 px-margin flex items-center justify-between">
          <div className="flex items-center gap-space-sm">
            <div className="w-7 h-7 rounded-xl bg-primary-container flex items-center justify-center text-on-primary-container">
              <span className="material-symbols-outlined text-[18px]">radar</span>
            </div>
            <span className="font-headline-sm text-headline-sm text-on-surface tracking-tight font-bold">Benemetrics</span>
          </div>
          <span className="px-space-xs py-0.5 rounded-DEFAULT bg-surface-container font-label-code-sm text-label-code-sm text-primary uppercase">v2.4</span>
        </div>
        <div className="px-margin py-space-xs">
          <button className="w-full flex items-center justify-between px-space-md py-space-xs bg-surface-container-low hover:bg-surface-container hover:text-on-surface rounded-xl transition-all text-left group" type="button">
            <div className="flex items-center gap-space-sm min-w-0">
              <span className="material-symbols-outlined text-secondary text-[16px]">terminal</span>
              <div className="truncate">
                <div className="font-label-code-md text-label-code-md text-on-surface font-semibold truncate">api-gateway</div>
                <div className="font-label-code-sm text-label-code-sm text-on-surface-variant flex items-center gap-space-xs">
                  <span className="w-1.5 h-1.5 rounded-full bg-secondary inline-block"></span>env:production
                </div>
              </div>
            </div>
            <span className="material-symbols-outlined text-on-surface-variant group-hover:text-on-surface text-[18px]">unfold_more</span>
          </button>
        </div>
        <div className="px-margin pt-space-md pb-space-xs">
          <span className="font-label-code-sm text-label-code-sm uppercase tracking-wider text-outline px-space-xs">Telemetry Observability</span>
        </div>
        <nav className="px-space-sm space-y-0.5 flex flex-col">
          {SIDEBAR_LINKS.map((link) => {
            const active = location.pathname === link.path || (link.path === '/admin' && location.pathname.startsWith('/admin'));
            return (
              <Link
                key={link.path}
                to={link.path}
                className={cn(
                  'flex items-center justify-between px-space-md py-space-xs rounded-xl transition-colors group',
                  active
                    ? 'bg-surface-container-high text-primary font-semibold'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                )}
              >
                <div className="flex items-center gap-space-md">
                  <span className={cn('material-symbols-outlined text-[18px] transition-colors', !active && 'group-hover:text-primary')}>
                    {link.icon}
                  </span>
                  <span className="font-body-md text-body-md">{link.label}</span>
                </div>
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex flex-col gap-space-xs px-space-sm pb-space-md">
        <div className="px-space-md py-space-xs rounded-xl bg-surface-container-low flex items-center justify-between mb-space-xs">
          <div className="flex items-center gap-space-sm">
            <span className={cn('relative flex h-2 w-2', health?.status === 'ok' && 'animate-ping')}>
              <span className={cn('relative inline-flex rounded-full h-2 w-2', health?.status === 'ok' ? 'bg-secondary' : 'bg-error')}></span>
            </span>
            <span className="font-label-code-sm text-label-code-sm text-on-surface">
              {health ? `${health.eventsStored} events stored` : 'Connecting…'}
            </span>
          </div>
          <span className={cn('font-label-code-sm text-label-code-sm', health?.status === 'ok' ? 'text-secondary' : 'text-error')}>
            {health?.status === 'ok' ? 'online' : 'offline'}
          </span>
        </div>
        <nav className="space-y-0.5 flex flex-col">
          <a className="flex items-center gap-space-md px-space-md py-space-xs rounded-xl text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors group" href="#">
            <span className="material-symbols-outlined text-[18px] group-hover:text-primary transition-colors">menu_book</span>
            <span className="font-body-md text-body-md">Docs</span>
          </a>
          <a className="flex items-center gap-space-md px-space-md py-space-xs rounded-xl text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors group" href="#">
            <span className="material-symbols-outlined text-[18px] group-hover:text-primary transition-colors">settings</span>
            <span className="font-body-md text-body-md">Settings</span>
          </a>
        </nav>
      </div>
    </aside>
  );
}
