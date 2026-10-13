import { useLocation, Link } from 'react-router-dom';
import { cn } from '../lib/utils';

interface NavLink {
  path: string;
  label: string;
  icon: string;
}

interface MobileNavBarProps {
  links: NavLink[];
}

export function MobileNavBar({ links }: MobileNavBarProps) {
  const location = useLocation();

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-50 pb-safe bg-surface/90 backdrop-blur-xl shadow-[0_-2px_16px_rgba(0,0,0,0.5)]"
    >
      <div className="flex items-center justify-around h-16 px-1">
        {links.map(({ path, label, icon }) => (
          <Link
            key={path}
            to={path}
            className={cn(
              'flex flex-col items-center justify-center min-w-[64px] h-12 transition-colors',
              location.pathname === path
                ? 'text-primary font-semibold'
                : 'text-on-surface-variant hover:text-on-surface'
            )}
          >
            <span className="text-[22px] mds">{icon}</span>
            <span className="text-code-sm mt-0.5">{label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}