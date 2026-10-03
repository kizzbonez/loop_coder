import { useEffect, useMemo, useState } from 'react';
import type { BurndownPointDTO } from '@loop/shared';
import { formatDateTime } from '../../lib/format';

const HEIGHT = 200;
const PAD = { top: 16, right: 16, bottom: 26, left: 34 };

/** Width of an element, tracked with a callback ref so it works when the element mounts late. */
function useWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width];
}

const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const shortTime = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

/**
 * Sprint burndown: remaining story points as a step line (with a light area wash) against a
 * neutral "ideal" guideline. Crosshair tooltip on hover/focus; an equivalent table for screen readers.
 */
export function BurndownChart({ points }: { points: BurndownPointDTO[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const data = useMemo(() => points.map((p) => ({ t: new Date(p.at).getTime(), v: p.remainingPoints })), [points]);
  if (data.length < 2) return null;

  const t0 = data[0]!.t;
  const t1 = Math.max(data[data.length - 1]!.t, t0 + 1000); // the last point is "now" or the sprint end
  const total = data[0]!.v;
  const yMax = Math.max(total, 1);
  const innerW = Math.max(width - PAD.left - PAD.right, 10);
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const x = (t: number) => PAD.left + ((t - t0) / (t1 - t0)) * innerW;
  const y = (v: number) => PAD.top + innerH - (v / yMax) * innerH;
  const spanMs = t1 - t0;
  const fmtTick = (t: number) => (spanMs < 36 * 3600_000 ? shortTime.format(t) : shortDate.format(t));

  // Step-after path: the value holds until the next completion.
  let line = `M${x(data[0]!.t)},${y(data[0]!.v)}`;
  for (let i = 1; i < data.length; i++) line += `H${x(data[i]!.t)}V${y(data[i]!.v)}`;
  const area = `${line}V${y(0)}H${x(data[0]!.t)}Z`;
  const yTicks = [0, Math.round(yMax / 2), yMax].filter((v, i, a) => a.indexOf(v) === i);
  const xTicks = [t0, t0 + spanMs / 2, t1];
  const last = data[data.length - 1]!;
  const hovered = hover != null ? data[hover] : undefined;

  const onMove = (clientX: number, rect: DOMRect) => {
    const t = t0 + ((clientX - rect.left - PAD.left) / innerW) * (t1 - t0);
    let best = 0;
    for (let i = 1; i < data.length; i++) if (Math.abs(data[i]!.t - t) < Math.abs(data[best]!.t - t)) best = i;
    setHover(best);
  };

  return (
    <figure>
      <figcaption className="mb-2 flex items-center gap-4 text-xs text-muted">
        <span className="font-medium text-fg">Burndown</span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-accent" /> Remaining points
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-subtle" /> Ideal
        </span>
      </figcaption>
      <div ref={ref} className="relative">
        {width > 0 && (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={`Burndown: ${total} points at start, ${last.v} remaining`}
            tabIndex={0}
            className="outline-none"
            onPointerMove={(e) => onMove(e.clientX, e.currentTarget.getBoundingClientRect())}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover(data.length - 1)}
            onBlur={() => setHover(null)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? data.length - 1) - 1));
              if (e.key === 'ArrowRight') setHover((h) => Math.min(data.length - 1, (h ?? 0) + 1));
            }}
          >
            {yTicks.map((v) => (
              <g key={v}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
                <text x={PAD.left - 8} y={y(v)} dy="0.32em" textAnchor="end" fontSize={10} fill="var(--subtle)">
                  {v}
                </text>
              </g>
            ))}
            {xTicks.map((t, i) => (
              <text key={i} x={x(t)} y={HEIGHT - 8} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'} fontSize={10} fill="var(--subtle)">
                {fmtTick(t)}
              </text>
            ))}

            <line x1={x(t0)} y1={y(total)} x2={x(t1)} y2={y(0)} stroke="var(--subtle)" strokeWidth={1.5} strokeLinecap="round" />
            <text x={x(t1) - 4} y={y(0) - 6} textAnchor="end" fontSize={10} fill="var(--subtle)">
              Ideal
            </text>

            <path d={area} fill="var(--accent)" opacity={0.1} />
            <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={x(last.t)} cy={y(last.v)} r={4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />

            {hovered && (
              <g pointerEvents="none">
                <line x1={x(hovered.t)} x2={x(hovered.t)} y1={PAD.top} y2={y(0)} stroke="var(--line-strong)" strokeWidth={1} />
                <circle cx={x(hovered.t)} cy={y(hovered.v)} r={4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
              </g>
            )}
          </svg>
        )}
        {hovered && (
          <div
            className="pointer-events-none absolute top-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-pop"
            style={{ left: Math.min(Math.max(x(hovered.t) - 70, 0), Math.max(width - 150, 0)) }}
          >
            <div className="text-muted">{formatDateTime(new Date(hovered.t).toISOString())}</div>
            <div className="font-semibold text-fg tabular-nums">{hovered.v} points remaining</div>
          </div>
        )}
      </div>
      <table className="sr-only">
        <caption>Remaining story points over time</caption>
        <thead>
          <tr>
            <th>Time</th>
            <th>Remaining points</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d, i) => (
            <tr key={i}>
              <td>{formatDateTime(new Date(d.t).toISOString())}</td>
              <td>{d.v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
