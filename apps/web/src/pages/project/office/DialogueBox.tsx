import { useEffect, useState } from 'react';
import type { OfficeAudio } from '../../../lib/office/audio';
import type { ChatLine } from '../../../lib/office/chatter';
import { hash } from '../../../lib/office/pixels';
import { TEXT_CPS, type TextSpeed } from '../../../lib/office/settings';
import { PixelAvatar } from './PixelAvatar';

/** The classic text box under the map: the latest line types itself out with little beeps. */
export function DialogueBox({ line, speed, audio, roleColor }: { line: ChatLine | null; speed: TextSpeed; audio: OfficeAudio; roleColor?: string }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!line) return;
    if (speed === 'instant') {
      setShown(line.text.length);
      return;
    }
    setShown(0);
    const pitch = 0.8 + (hash(line.speaker.name) % 7) * 0.08;
    const interval = 1000 / TEXT_CPS[speed];
    let i = 0;
    const timer = setInterval(() => {
      i++;
      setShown(i);
      if (i % 2 === 0 && line.text[i] && line.text[i] !== ' ') audio.blip(pitch);
      if (i >= line.text.length) clearInterval(timer);
    }, interval);
    return () => clearInterval(timer);
  }, [line, speed, audio]);

  const done = line ? shown >= line.text.length : true;
  return (
    <div className="office-font pixel-box relative mt-3 flex min-h-[88px] gap-3 px-4 py-3 text-[15px] leading-snug" aria-hidden>
      {line ? (
        <>
          <PixelAvatar name={line.speaker.name} roleKey={line.roleKey} roleColor={roleColor} human={line.speaker.kind === 'user'} size={2} />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-[#6b5a3e]">
              {line.speaker.name}
              {line.speaker.kind === 'user' && ' (you)'}
            </p>
            <p className="text-[#1f1b2e]">{line.text.slice(0, shown)}</p>
          </div>
          {done && <span className="pixel-blink absolute right-3 bottom-2 text-[#1f1b2e]">▼</span>}
        </>
      ) : (
        <p className="self-center text-[#6b5a3e]">The office is quiet. Click anyone or anything to say hello!</p>
      )}
    </div>
  );
}
