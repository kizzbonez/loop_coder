import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useElementWidth } from '../../../hooks/useMeasure';
import type { OfficeAudio } from '../../../lib/office/audio';
import { WORLD_H, WORLD_W } from '../../../lib/office/pixels';
import { FONT_FAMILY, renderOffice } from '../../../lib/office/render';
import type { OfficeSettings } from '../../../lib/office/settings';
import type { OfficeSim } from '../../../lib/office/sim';

/**
 * The pixel office canvas: runs the simulation, draws it every frame and turns clicks and keys
 * into pokes. Arrow keys move a pointer between people and things; Enter or Space pokes.
 */
export function OfficeCanvas({
  sim,
  audio,
  settings,
  onPoke,
  onOpenMenu,
}: {
  sim: OfficeSim;
  audio: OfficeAudio;
  settings: OfficeSettings;
  onPoke: (description: string) => void;
  onOpenMenu: () => void;
}) {
  const [measure, width] = useElementWidth<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const scale = Math.max(1, Math.min(8, Math.round(((width || WORLD_W * 2) * dpr) / WORLD_W)));

  // The render loop reads the latest options through a ref so it never restarts.
  const options = useRef({ names: settings.names, textSpeed: settings.textSpeed, focusId, hoverId });
  options.current = { names: settings.names, textSpeed: settings.textSpeed, focusId, hoverId };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let frameId = 0;
    let last = performance.now();
    void document.fonts?.load(`${6 * scale}px ${FONT_FAMILY}`).catch(() => undefined);
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      sim.update(dt);
      for (const { cue, pitch } of sim.drainCues()) audio.play(cue, pitch);
      renderOffice({ ctx, scale, time: sim.now }, sim, options.current);
      frameId = requestAnimationFrame(loop);
    };
    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, [sim, audio, scale]);

  const toWorld = (e: PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * WORLD_W, y: ((e.clientY - rect.top) / rect.height) * WORLD_H };
  };

  const poke = (id: string) => {
    audio.unlock();
    const result = sim.poke(id);
    if (result) onPoke(result);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLCanvasElement>) => {
    const targets = sim.targets();
    const index = targets.findIndex((t) => t.id === focusId);
    const move = (delta: number) => {
      e.preventDefault();
      const next = targets[(Math.max(0, index) + delta + targets.length) % targets.length];
      if (next) {
        setFocusId(next.id);
        audio.unlock();
        audio.play('select');
      }
    };
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') move(index === -1 ? 0 : 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') move(index === -1 ? 0 : -1);
    else if ((e.key === 'Enter' || e.key === ' ') && focusId) {
      e.preventDefault();
      poke(focusId);
    } else if (e.key === 'Escape') setFocusId(null);
    else if (e.key.toLowerCase() === 'm') {
      e.preventDefault();
      onOpenMenu();
    }
  };

  const focused = sim.targets().find((t) => t.id === focusId);
  return (
    // Never taller than the screen leaves room for, so the dialogue box stays in view.
    <div ref={measure} className="relative mx-auto w-full" style={{ maxWidth: 'max(320px, calc((100dvh - 360px) * 16 / 9))' }}>
      <canvas
        ref={canvasRef}
        width={WORLD_W * scale}
        height={WORLD_H * scale}
        tabIndex={0}
        role="application"
        aria-roledescription="game"
        aria-label={`Agent office. Arrow keys choose a person or object${focused ? ` (now: ${focused.label})` : ''}, Enter pokes it, M opens the menu.`}
        className="pixel-canvas block aspect-[16/9] w-full cursor-default rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        style={{ cursor: hoverId ? 'pointer' : 'default' }}
        onPointerMove={(e) => {
          const p = toWorld(e);
          setHoverId(sim.hitTest(p.x, p.y));
        }}
        onPointerLeave={() => setHoverId(null)}
        onClick={(e) => {
          const p = toWorld(e as unknown as PointerEvent<HTMLCanvasElement>);
          const id = sim.hitTest(p.x, p.y);
          audio.unlock();
          if (id) poke(id);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setFocusId(null)}
      />
    </div>
  );
}
