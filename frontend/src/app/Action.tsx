import type { ReactNode } from "react";

export function Action({
  children,
  variant = "ghost",
  onClick,
  active,
}: {
  children: ReactNode;
  variant?: "ghost" | "primary" | "soft";
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <div
      className={`action action-${variant}${active ? " is-active" : ""}`}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => event.key === "Enter" && onClick?.()}
    >
      {children}
    </div>
  );
}
