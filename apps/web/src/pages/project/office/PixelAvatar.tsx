import { useEffect, useRef } from 'react';
import { drawCharacter, type Look } from '../../../lib/office/characters';

/** A character drawn as a small pixel portrait. */
export function PixelAvatar({ look, size = 2 }: { look: Look; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 16 * size, 26 * size);
    ctx.imageSmoothingEnabled = false;
    drawCharacter({ ctx, scale: size, time: 0 }, look, 8, 25, { dir: 'down', frame: 0 });
  }, [look, size]);
  return <canvas ref={ref} width={16 * size} height={26 * size} className="pixel-canvas shrink-0" style={{ width: 16 * size, height: 26 * size }} aria-hidden />;
}
