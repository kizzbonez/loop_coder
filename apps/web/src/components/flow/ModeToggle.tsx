import clsx from 'clsx';
import { History, Radio } from 'lucide-react';

/** Live / Replay switch shared by the Flow and Office tabs. */
export function ModeToggle({ replaying, onChange, label }: { replaying: boolean; onChange: (replay: boolean) => void; label: string }) {
  return (
    <div className="flex rounded-lg bg-surface-2 p-0.5 text-[13px]" role="radiogroup" aria-label={label}>
      {(
        [
          [false, 'Live', Radio],
          [true, 'Replay', History],
        ] as const
      ).map(([mode, text, Icon]) => {
        const active = replaying === mode;
        return (
          <button
            key={text}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(mode)}
            className={clsx('flex items-center gap-1.5 rounded-md px-3 py-1 transition', active ? 'bg-surface text-fg shadow-card' : 'text-muted hover:text-fg')}
          >
            <Icon className={clsx('size-3.5', !mode && active && 'text-success')} />
            {text}
          </button>
        );
      })}
    </div>
  );
}
