import clsx from 'clsx';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** Small accessible dropdown menu. */
export function Menu({
  trigger,
  items,
  align = 'end',
  header,
}: {
  trigger: (props: { onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' }) => ReactNode;
  items: MenuItem[];
  align?: 'start' | 'end';
  header?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {trigger({ onClick: () => setOpen((o) => !o), 'aria-expanded': open, 'aria-haspopup': 'menu' })}
      {open && (
        <div
          role="menu"
          className={clsx(
            'absolute z-30 mt-1 min-w-48 overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-pop',
            align === 'end' ? 'right-0' : 'left-0',
          )}
        >
          {header && <div className="border-b border-line px-2.5 pt-1.5 pb-2">{header}</div>}
          {items.map(({ label, icon: Icon, onSelect, danger, disabled }) => (
            <button
              key={label}
              role="menuitem"
              type="button"
              disabled={disabled}
              onClick={() => {
                setOpen(false);
                onSelect();
              }}
              className={clsx(
                'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition disabled:opacity-40',
                danger ? 'text-danger hover:bg-danger/10' : 'text-fg hover:bg-surface-2',
              )}
            >
              {Icon && <Icon className="size-4 text-muted" />}
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
