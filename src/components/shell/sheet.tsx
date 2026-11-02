'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * Slides in from the right on a desktop and up from the bottom on a phone.
 * A real <dialog>, so focus stays inside, Esc closes it, and the page
 * behind can't be tabbed to.
 */
export function Sheet({ title, subtitle, onClose, children, footer }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label={title}
      className="sheet-in glass-solid fixed inset-x-0 top-auto bottom-0 m-0 flex max-h-[90dvh] w-full max-w-none flex-col !rounded-b-none text-ink backdrop:bg-black/50 sm:inset-y-3 sm:right-3 sm:left-auto sm:h-[calc(100dvh-24px)] sm:max-h-none sm:w-[480px] sm:!rounded-b-[20px]"
    >
      <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4">
        <div className="min-w-0">
          <h2 className="text-[22px] leading-tight font-medium">{title}</h2>
          {subtitle && <p className="mt-1 text-[13.5px] text-body">{subtitle}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-hairline-strong hover:bg-surface-strong">
          <X size={18} />
        </button>
      </div>
      {/* flex-auto, not flex-1: Safari sizes a phone sheet from this box's basis, and a zero basis collapses the sheet. */}
      <div className="min-h-0 flex-auto overflow-y-auto overscroll-contain px-6 pb-5">{children}</div>
      {footer && <div className="flex items-center gap-2.5 border-t border-hairline px-6 py-4">{footer}</div>}
    </dialog>
  );
}

export function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-[13px] font-medium text-body">
      {label}
      {children}
    </label>
  );
}
