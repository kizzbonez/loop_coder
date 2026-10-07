import { useEffect, useRef } from 'react';
import { drawCharacter, lookFor } from '../../../lib/office/characters';

/** A character drawn as a small pixel portrait. */
export function PixelAvatar({
  name,
  roleKey,
  roleColor,
  human = false,
  size = 2,
}: {
  name: string;
  roleKey: string | null;
  roleColor?: string;
  human?: boolean;
  size?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 16 * size, 26 * size);
    ctx.imageSmoothingEnabled = false;
    const look = lookFor(name, human || !roleKey ? null : { key: roleKey, color: roleColor });
    drawCharacter({ ctx, scale: size, time: 0 }, look, 8, 25, { dir: 'down', frame: 0 });
  }, [name, roleKey, roleColor, human, size]);
  return <canvas ref={ref} width={16 * size} height={26 * size} className="pixel-canvas shrink-0" style={{ width: 16 * size, height: 26 * size }} aria-hidden />;
}
