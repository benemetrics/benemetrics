import { useEffect } from "react";
import { Btn } from "./ui-kit";
import { cn } from "../lib/utils";

export function ConfirmAction({
  open,
  onClose,
  onConfirm,
  title,
  description,
  label,
  danger = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  label: string;
  danger?: boolean;
}) {
  useEscapeClose(onClose, open);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div
        className={cn(
          "relative w-full max-w-md rounded-lg border bg-card p-6 shadow-xl",
          danger ? "border-destructive" : "border-border",
        )}
      >
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>
            Cancel
          </Btn>
          <Btn
            variant={danger ? "danger" : "primary"}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {label}
          </Btn>
        </div>
      </div>
    </div>
  );
}

function useEscapeClose(onClose: () => void, open: boolean) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
}
