import { cn } from '../../lib/utils';

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  className?: string;
}

export function ToggleSwitch({ checked, onChange, label, className }: ToggleSwitchProps) {
  return (
    <label className={cn('flex items-center gap-1.5 cursor-pointer select-none', className)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      <span
        className={cn(
          'w-8 h-4.5 rounded-full flex items-center p-0.5 transition-colors relative',
          checked ? 'bg-primary-container' : 'bg-surface-container-highest'
        )}
      >
        <span
          className={cn(
            'w-3.5 h-3.5 bg-surface rounded-full absolute shadow-sm transform transition-transform',
            checked ? 'translate-x-3.5' : 'translate-x-0'
          )}
        />
      </span>
      {label && <span className="text-code-sm text-on-surface">{label}</span>}
    </label>
  );
}