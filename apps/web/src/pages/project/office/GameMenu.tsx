import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import type { OfficeAudio } from '../../../lib/office/audio';
import { TRACKS } from '../../../lib/office/music';
import { TEXT_SPEEDS, type OfficeSettings } from '../../../lib/office/settings';

type Row =
  | { kind: 'toggle'; key: 'music' | 'sfx' | 'names'; label: string }
  | { kind: 'volume'; key: 'musicVolume' | 'sfxVolume'; label: string }
  | { kind: 'choice'; key: 'track' | 'textSpeed'; label: string }
  | { kind: 'close'; label: string };

const ROWS: Row[] = [
  { kind: 'toggle', key: 'music', label: 'Music' },
  { kind: 'choice', key: 'track', label: 'Track' },
  { kind: 'volume', key: 'musicVolume', label: 'Music volume' },
  { kind: 'toggle', key: 'sfx', label: 'Sound effects' },
  { kind: 'volume', key: 'sfxVolume', label: 'Effects volume' },
  { kind: 'toggle', key: 'names', label: 'Name tags' },
  { kind: 'choice', key: 'textSpeed', label: 'Text speed' },
  { kind: 'close', label: 'Back to the office' },
];

const SPEED_LABELS: Record<OfficeSettings['textSpeed'], string> = { slow: 'Slow', normal: 'Normal', fast: 'Fast', instant: 'Instant' };

function valueText(row: Row, s: OfficeSettings): string {
  switch (row.kind) {
    case 'toggle':
      return s[row.key] ? 'ON' : 'OFF';
    case 'volume':
      return `${Math.round(s[row.key] * 10)}/10`;
    case 'choice':
      return row.key === 'track' ? (TRACKS.find((t) => t.id === s.track)?.title ?? s.track) : SPEED_LABELS[s.textSpeed];
    case 'close':
      return '';
  }
}

function change(row: Row, s: OfficeSettings, delta: number): OfficeSettings {
  switch (row.kind) {
    case 'toggle':
      return { ...s, [row.key]: !s[row.key] };
    case 'volume':
      return { ...s, [row.key]: Math.round(Math.min(1, Math.max(0, s[row.key] + delta * 0.1)) * 10) / 10 };
    case 'choice': {
      if (row.key === 'track') {
        const i = TRACKS.findIndex((t) => t.id === s.track);
        return { ...s, track: TRACKS[(i + delta + TRACKS.length) % TRACKS.length]!.id, music: true };
      }
      const i = TEXT_SPEEDS.indexOf(s.textSpeed);
      return { ...s, textSpeed: TEXT_SPEEDS[(i + delta + TEXT_SPEEDS.length) % TEXT_SPEEDS.length]! };
    }
    case 'close':
      return s;
  }
}

/** A game-style settings menu: ↑/↓ to choose, ←/→ to change, Enter to toggle, Esc to close. */
export function GameMenu({ settings, onChange, onClose, audio }: { settings: OfficeSettings; onChange: (s: OfficeSettings) => void; onClose: () => void; audio: OfficeAudio }) {
  const [active, setActive] = useState(0);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => refs.current[active]?.focus(), [active]);

  const apply = (row: Row, delta: number) => {
    audio.unlock();
    if (row.kind === 'close') {
      audio.play('select');
      onClose();
      return;
    }
    onChange(change(row, settings, delta));
    audio.play('select');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Game menu"
      className="office-font pixel-box absolute top-3 right-3 z-30 w-[min(340px,calc(100%-24px))] p-3 text-[15px]"
      onKeyDown={(e) => {
        const row = ROWS[active]!;
        if (e.key === 'ArrowDown') setActive((i) => (i + 1) % ROWS.length);
        else if (e.key === 'ArrowUp') setActive((i) => (i - 1 + ROWS.length) % ROWS.length);
        else if (e.key === 'ArrowRight') apply(row, 1);
        else if (e.key === 'ArrowLeft') apply(row, -1);
        else if (e.key === 'Escape' || e.key.toLowerCase() === 'm') onClose();
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <p className="mb-2 px-2 text-xs tracking-[0.2em] text-[#8c7a5b] uppercase">Menu</p>
      <ul className="space-y-0.5">
        {ROWS.map((row, i) => (
          <li key={row.label}>
            <button
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              onFocus={() => setActive(i)}
              onClick={() => apply(row, 1)}
              aria-label={row.kind === 'close' ? row.label : `${row.label}: ${valueText(row, settings)}`}
              className={clsx('flex w-full items-center gap-2 rounded px-2 py-1 text-left outline-none', i === active ? 'bg-[#f3e6c4]' : 'hover:bg-[#f7eedb]')}
            >
              <span className={clsx('w-3 text-[#1f1b2e]', i === active ? 'pixel-blink' : 'invisible')} aria-hidden>
                ▶
              </span>
              <span className="flex-1">{row.label}</span>
              {row.kind === 'volume' ? (
                <span className="flex gap-0.5" aria-hidden>
                  {Array.from({ length: 10 }, (_, k) => (
                    <span key={k} className={clsx('h-3 w-1.5', k < Math.round(settings[row.key] * 10) ? 'bg-[#1f1b2e]' : 'bg-[#d8c9a3]')} />
                  ))}
                </span>
              ) : row.kind !== 'close' ? (
                <span className="flex items-center gap-1 text-[#4a3b6b]">
                  {row.kind === 'choice' && <span aria-hidden>◀</span>}
                  <span className={clsx(row.kind === 'toggle' && (settings[row.key] ? 'text-[#2e7d48]' : 'text-[#b04a3c]'))}>{valueText(row, settings)}</span>
                  {row.kind === 'choice' && <span aria-hidden>▶</span>}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 px-2 text-[11px] text-[#8c7a5b]">↑↓ choose · ←→ change · Enter toggle · Esc close</p>
    </div>
  );
}
