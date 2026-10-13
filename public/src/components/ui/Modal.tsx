import type { ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  header?: ReactNode;
}

export function Modal({ open, onClose, title, children }: ModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-surface/90 backdrop-blur-md hidden transition-opacity duration-200"
      style={{ display: open ? 'flex' : 'none' }}
    >
      <div className="flex-1 w-full max-w-md bg-surface-container-high rounded-t-xl mx-auto shadow-2xl flex flex-col max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-2 border-b border-outline-variant">
          <div className="flex items-center gap-2">
            <span className="text-primary text-18px mds">assignment_ind</span>
            {title && (
              <h2 className="text-headline-sm text-on-surface font-semibold">
                {title}
              </h2>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center hover:bg-surface-bright transition-colors"
          >
            <span className="text-18px mds">close</span>
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}