// Game settings for the agent office, remembered per browser. Stored values are validated, so a
// tampered or outdated entry falls back to the defaults instead of breaking the page.
import { TRACKS, type TrackId } from './music';

export type TextSpeed = 'slow' | 'normal' | 'fast' | 'instant';

export interface OfficeSettings {
  music: boolean;
  musicVolume: number;
  track: TrackId;
  sfx: boolean;
  sfxVolume: number;
  names: boolean;
  textSpeed: TextSpeed;
}

export const DEFAULT_SETTINGS: OfficeSettings = {
  music: false,
  musicVolume: 0.5,
  track: 'standup',
  sfx: true,
  sfxVolume: 0.6,
  names: true,
  textSpeed: 'normal',
};

export const TEXT_SPEEDS: readonly TextSpeed[] = ['slow', 'normal', 'fast', 'instant'];
const KEY = 'lc-office-settings';

const volume = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(1, Math.max(0, v)) * 10) / 10 : fallback);

export function parseSettings(raw: unknown): OfficeSettings {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_SETTINGS;
  return {
    music: typeof o.music === 'boolean' ? o.music : d.music,
    musicVolume: volume(o.musicVolume, d.musicVolume),
    track: TRACKS.some((t) => t.id === o.track) ? (o.track as TrackId) : d.track,
    sfx: typeof o.sfx === 'boolean' ? o.sfx : d.sfx,
    sfxVolume: volume(o.sfxVolume, d.sfxVolume),
    names: typeof o.names === 'boolean' ? o.names : d.names,
    textSpeed: TEXT_SPEEDS.includes(o.textSpeed as TextSpeed) ? (o.textSpeed as TextSpeed) : d.textSpeed,
  };
}

export function loadSettings(): OfficeSettings {
  try {
    return parseSettings(JSON.parse(localStorage.getItem(KEY) ?? '{}'));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: OfficeSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* private mode or storage blocked: settings last for this visit only */
  }
}
