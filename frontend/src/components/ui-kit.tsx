import type { ReactNode } from "react";
import type { Level } from "../lib/data";
import { Link } from "react-router-dom";
import { cn } from "../lib/utils";

const levelClass: Record<Level, string> = {
  fatal: "bg-destructive/20 text-destructive border-destructive/40",
  error: "bg-destructive/10 text-destructive border-destructive/30",
  warning: "bg-warning/10 text-warning border-warning/30",
  info: "bg-info/10 text-info border-info/30",
};

export function LevelBadge({ level }: { level: Level }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider",
        levelClass[level],
      )}
    >
      {level}
    </span>
  );
}

export function Pill({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "primary" | "warning" | "destructive";
}) {
  const tones = {
    muted: "bg-muted text-muted-foreground border-border",
    primary: "bg-accent text-accent-foreground border-primary/30",
    warning: "bg-warning/10 text-warning border-warning/30",
    destructive: "bg-destructive/10 text-destructive border-destructive/30",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[11px]",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Sparkline({
  data,
  className,
}: {
  data: number[];
  className?: string;
}) {
  const max = Math.max(...data, 1);
  const w = 96;
  const h = 24;
  const bw = w / data.length;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={cn("h-6 w-24", className)}
      preserveAspectRatio="none"
    >
      {data.map((v, i) => {
        const bh = Math.max(1, (v / max) * h);
        return (
          <rect
            key={i}
            x={i * bw + 0.5}
            y={h - bh}
            width={bw - 1}
            height={bh}
            className="fill-primary/70"
          />
        );
      })}
    </svg>
  );
}

export function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full border transition-colors",
        on ? "border-primary bg-primary/30" : "border-border bg-muted",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all",
          on ? "left-[18px] bg-primary" : "left-0.5 bg-muted-foreground",
        )}
      />
    </button>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="panel p-4">
      <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function Crumbs({
  items,
}: {
  items: { label: string; to?: string; params?: Record<string, string> }[];
}) {
  return (
    <nav className="flex flex-wrap items-center gap-1 font-mono text-xs text-muted-foreground">
      <span className="text-primary">~</span>
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1">
          <span>/</span>
          {it.to ? (
            <Link to={it.to} className="hover:text-foreground">
              {it.label}
            </Link>
          ) : (
            <span className="text-foreground">{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function Btn({
  children,
  variant = "ghost",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger";
}) {
  const v = {
    primary:
      "bg-primary text-primary-foreground hover:bg-primary/90 border-primary",
    ghost:
      "bg-secondary text-secondary-foreground hover:bg-muted border-border",
    danger:
      "bg-destructive/10 text-destructive hover:bg-destructive/20 border-destructive/30",
  };
  return (
    <button
      {...props}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50",
        v[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}
