// Original chiptune loops for the agent office, written in a tiny tracker notation: one token per
// eighth note ("C5" a note, "-" holds the previous note, "." is a rest; drums use k/s/h/o/x).
// Every track is 8 bars of 8 steps and loops seamlessly.

export const STEPS_PER_BAR = 8;
export const BARS = 8;
export const STEPS = STEPS_PER_BAR * BARS;

export type TrackId = 'standup' | 'focus' | 'release';

export interface Track {
  id: TrackId;
  title: string;
  bpm: number;
  /** One chord name per bar, used for the arpeggio. */
  chords: string[];
  lead: string;
  bass: string;
  drums: string;
}

export const TRACKS: readonly Track[] = [
  {
    id: 'standup',
    title: 'Morning Stand-up',
    bpm: 132,
    chords: ['C', 'G', 'Am', 'F', 'C', 'G', 'F', 'G'],
    lead: `
      E5 -  G5 E5 C5 -  D5 E5 | D5 -  B4 G4 B4 -  D5 G5 | C5 -  E5 A5 G5 E5 C5 -  | A4 C5 F5 -  E5 D5 C5 -
      E5 G5 C6 -  B5 G5 E5 G5 | D5 -  G5 -  F5 D5 B4 -  | C5 F5 A5 -  G5 F5 E5 D5 | D5 -  -  .  G4 B4 D5 F5`,
    bass: `
      C2 .  C3 .  C2 C2 C3 .  | G2 .  G3 .  G2 G2 G3 .  | A2 .  A3 .  A2 A2 A3 .  | F2 .  F3 .  F2 F2 F3 .
      C2 .  C3 .  C2 C2 C3 .  | G2 .  G3 .  G2 G2 G3 .  | F2 .  F3 .  F2 F2 F3 .  | G2 .  G3 .  G2 B2 D3 .`,
    drums: `
      k h s h k k s h | k h s h k k s h | k h s h k k s h | k h s h k k s o
      k h s h k k s h | k h s h k k s h | k h s h k k s h | k h s h k s s s`,
  },
  {
    id: 'focus',
    title: 'Deep Focus',
    bpm: 92,
    chords: ['Am', 'F', 'C', 'G', 'Am', 'F', 'G', 'E'],
    lead: `
      A4 -  -  C5 E5 -  -  .  | F5 -  E5 -  C5 -  -  .  | E5 -  G5 -  E5 D5 C5 -  | D5 -  -  -  B4 -  -  .
      A4 -  C5 E5 A5 -  G5 -  | F5 -  -  E5 D5 -  C5 -  | B4 -  D5 -  G5 -  F5 -  | E5 -  -  -  G#4 - B4 -`,
    bass: `
      A2 -  -  -  A2 -  E2 -  | F2 -  -  -  F2 -  C3 -  | C3 -  -  -  C3 -  G2 -  | G2 -  -  -  G2 -  D3 -
      A2 -  -  -  A2 -  E2 -  | F2 -  -  -  F2 -  C3 -  | G2 -  -  -  G2 -  D3 -  | E2 -  -  -  E2 -  B2 -`,
    drums: `
      k . h . s . h . | k . h . s . h h | k . h . s . h . | k . h . s . h .
      k . h . s . h . | k . h . s . h h | k . h . s . h . | k . h . s s h o`,
  },
  {
    id: 'release',
    title: 'Release Day',
    bpm: 150,
    chords: ['G', 'D', 'Em', 'C', 'G', 'D', 'C', 'D'],
    lead: `
      G5 -  D5 G5 B5 -  A5 G5 | F#5 - A5 -  D5 -  F#5 A5 | G5 -  E5 -  B4 E5 G5 B5 | C6 -  B5 A5 G5 -  E5 -
      D5 G5 B5 -  D6 -  B5 G5 | A5 -  F#5 - D5 E5 F#5 A5 | G5 -  E5 C5 E5 G5 C6 -  | D6 -  C6 B5 A5 -  F#5 D5`,
    bass: `
      G2 G3 G2 G3 G2 G3 G2 G3 | D2 D3 D2 D3 D2 D3 D2 D3 | E2 E3 E2 E3 E2 E3 E2 E3 | C2 C3 C2 C3 C2 C3 C2 C3
      G2 G3 G2 G3 G2 G3 G2 G3 | D2 D3 D2 D3 D2 D3 D2 D3 | C2 C3 C2 C3 C2 C3 C2 C3 | D2 D3 D2 D3 F#2 F#3 A2 A3`,
    drums: `
      x h s h k h s h | x h s h k h s h | x h s h k h s h | x h s h k h s o
      x h s h k h s h | x h s h k h s h | x h s h k h s h | x s s s x s s s`,
  },
];

const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "C4" → 60 (MIDI), "F#5" → 78, "Bb3" → 58; null for anything else. */
export function noteToMidi(name: string): number | null {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) return null;
  const base = NOTE_INDEX[m[1]!]! + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return (Number(m[3]) + 1) * 12 + base;
}

export const midiToHz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

export interface NoteEvent {
  step: number;
  midi: number;
  /** Length in steps. */
  length: number;
}

export function tokens(voice: string): string[] {
  return voice.split(/[\s|]+/).filter(Boolean);
}

/** Melodic voice → notes with their lengths. */
export function parseVoice(voice: string): NoteEvent[] {
  const events: NoteEvent[] = [];
  tokens(voice).forEach((token, step) => {
    if (token === '-') {
      const last = events.at(-1);
      if (last && last.step + last.length === step) last.length++;
      return;
    }
    if (token === '.') return;
    const midi = noteToMidi(token);
    if (midi === null) throw new Error(`Unknown note "${token}" at step ${step}`);
    events.push({ step, midi, length: 1 });
  });
  return events;
}

export type Drum = 'kick' | 'snare' | 'hat' | 'open';

export function parseDrums(voice: string): Array<{ step: number; hits: Drum[] }> {
  const map: Record<string, Drum[]> = { k: ['kick'], s: ['snare'], h: ['hat'], o: ['open'], x: ['kick', 'hat'] };
  return tokens(voice).flatMap((token, step) => {
    if (token === '.') return [];
    const hits = map[token];
    if (!hits) throw new Error(`Unknown drum "${token}" at step ${step}`);
    return [{ step, hits }];
  });
}

const CHORD_SHAPES: Record<string, number[]> = { '': [0, 4, 7, 12], m: [0, 3, 7, 12] };

/** Chord name ("Am", "F#", "E") → arpeggio notes around octave 4. */
export function chordNotes(chord: string): number[] {
  const m = /^([A-G](?:#|b)?)(m?)$/.exec(chord);
  if (!m) throw new Error(`Unknown chord "${chord}"`);
  const root = noteToMidi(`${m[1]}4`)!;
  return CHORD_SHAPES[m[2]!]!.map((i) => root + i);
}

/** Everything a track plays, parsed once. */
export function compileTrack(track: Track) {
  return {
    ...track,
    leadNotes: parseVoice(track.lead),
    bassNotes: parseVoice(track.bass),
    drumHits: parseDrums(track.drums),
    arps: track.chords.map(chordNotes),
    stepSeconds: 60 / track.bpm / 2,
  };
}

export type CompiledTrack = ReturnType<typeof compileTrack>;
