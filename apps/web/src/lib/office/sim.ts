// The agent office simulation: who walks where, who says what, and how things react when poked.
// Pure state + time steps, no DOM, so it can be tested and drawn by any renderer.
import type { StageId } from '../flow/model';
import { lookFor, type Dir, type Look } from './characters';
import { hash, TILE } from './pixels';
import { findPath, HELPDESK_STAFF, OBJECTS, STATIONS, stationFor, zoneTiles, type ObjectKind, type Spot, type StationId } from './world';

export type Emote = 'alert' | 'question' | 'anger' | 'sweat' | 'sleep' | 'heart' | 'sparkle' | 'dots';
export type SfxCue =
  | 'step'
  | 'poof'
  | 'door'
  | 'squeak'
  | 'brew'
  | 'ding'
  | 'rustle'
  | 'jam'
  | 'glug'
  | 'meow'
  | 'hiss'
  | 'gong'
  | 'beep'
  | 'annoyed'
  | 'chime'
  | 'jingle'
  | 'fanfare'
  | 'paper'
  | 'select';
export type BubbleTone = 'say' | 'question' | 'answer' | 'shout' | 'object';

export interface Walker {
  id: string;
  name: string;
  kind: 'agent' | 'human';
  look: Look;
  roleKey: string | null;
  taskKey: string | null;
  /** Feet position in world pixels. */
  x: number;
  y: number;
  path: Array<{ x: number; y: number }>;
  dir: Dir;
  walked: number;
  station: StationId | null;
  spot: Spot | null;
  working: boolean;
  emote: { kind: Emote; until: number } | null;
  pokes: number;
  lastPoke: number;
  shakeUntil: number;
  hopUntil: number;
  leaving: boolean;
  /** Humans step out again after answering. */
  leaveAt: number | null;
}

export interface Cat {
  x: number;
  y: number;
  path: Array<{ x: number; y: number }>;
  dir: 'left' | 'right';
  walked: number;
  speed: number;
  sleepingUntil: number;
  nextMoveAt: number;
  pokes: number;
  lastPoke: number;
  emote: { kind: Emote; until: number } | null;
}

export interface Bubble {
  ownerId: string;
  text: string;
  tone: BubbleTone;
  started: number;
  until: number;
}

export interface ObjectState {
  count: number;
  last: number;
  /** The reaction animation runs until this time. */
  until: number;
}

export interface SimAgent {
  id: string;
  name: string;
  stage: StageId;
  roleKey: string | null;
  roleColor: string | null;
  working: boolean;
  taskKey: string | null;
}

export const WALK_SPEED = 72; // world px per second
const CAT_ID = 'cat';
const POKE_RESET = 6; // seconds without a poke before someone calms down

export const tileFeet = (t: { x: number; y: number }) => ({ x: t.x * TILE + TILE / 2, y: t.y * TILE + TILE - 1 });
const tileOf = (x: number, y: number) => ({ x: Math.floor(x / TILE), y: Math.floor((y - 1) / TILE) });

/** Small seeded RNG (mulberry32): the same seed gives the same office. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How long a bubble stays up: longer text, longer bubble. */
export function bubbleSeconds(text: string, speed: 'slow' | 'normal' | 'fast' | 'instant' = 'normal'): number {
  const factor = speed === 'slow' ? 1.5 : speed === 'fast' ? 0.75 : speed === 'instant' ? 0.6 : 1;
  return Math.min(10, (2.6 + text.length * 0.055) * factor);
}

export class OfficeSim {
  readonly walkers = new Map<string, Walker>();
  readonly bubbles = new Map<string, Bubble>();
  readonly objects = new Map<string, ObjectState>();
  readonly cat: Cat;
  stats: Partial<Record<StageId, number>> = {};
  textSpeed: 'slow' | 'normal' | 'fast' | 'instant' = 'normal';
  now = 0;
  private cues: Array<{ cue: SfxCue; pitch?: number }> = [];
  private readonly random: () => number;

  constructor(seed = 7) {
    this.random = rng(seed);
    const start = tileFeet({ x: 5, y: 15 });
    this.cat = { ...start, path: [], dir: 'left', walked: 0, speed: 26, sleepingUntil: 0, nextMoveAt: 3, pokes: 0, lastPoke: -99, emote: null };
  }

  // --- Agents ---------------------------------------------------------------

  /** Bring the office in line with the agents online and where they work. */
  sync(agents: SimAgent[], rolesByKey: Map<string, { key: string; color: string }> = new Map()): void {
    const taken = new Map<StationId, number>();
    const present = new Set<string>();
    for (const a of agents) {
      present.add(a.id);
      const station = stationFor(a.stage, a.roleKey);
      const index = taken.get(station) ?? 0;
      taken.set(station, index + 1);
      const spots = STATIONS[station];
      const spot = spots[index % spots.length]!;
      const role = a.roleKey ? (rolesByKey.get(a.roleKey) ?? { key: a.roleKey, color: a.roleColor ?? '' }) : null;
      let w = this.walkers.get(a.id);
      if (!w) {
        const door = tileFeet(STATIONS.door[this.walkers.size % STATIONS.door.length]!);
        w = this.newWalker(a.id, a.name, 'agent', door.x, door.y, lookFor(a.name, role));
        this.walkers.set(a.id, w);
        this.cue('door');
      } else if (w.roleKey !== a.roleKey) {
        // Changing role means changing clothes.
        w.look = lookFor(a.name, role);
        w.emote = { kind: 'sparkle', until: this.now + 1.2 };
        this.cue('poof');
      }
      w.roleKey = a.roleKey;
      w.taskKey = a.taskKey;
      w.working = a.working;
      w.leaving = false;
      if (w.station !== station || w.spot?.x !== spot.x || w.spot?.y !== spot.y) {
        w.station = station;
        w.spot = spot;
        this.route(w, spot);
      }
    }
    for (const w of this.walkers.values()) {
      if (w.kind === 'agent' && !present.has(w.id) && !w.leaving) this.leave(w);
    }
  }

  /** Someone speaks: an agent by name, or a person who then walks up to the help desk. */
  say(speaker: { name: string; kind: 'agent' | 'user' | 'system' }, text: string, tone: BubbleTone = 'say'): string | null {
    let owner: Walker | undefined;
    if (speaker.kind === 'agent') {
      owner = [...this.walkers.values()].find((w) => w.kind === 'agent' && w.name === speaker.name && !w.leaving);
    } else if (speaker.kind === 'user') {
      owner = this.visitHelpDesk(speaker.name);
    }
    if (!owner) return null;
    this.bubbles.set(owner.id, { ownerId: owner.id, text, tone, started: this.now, until: this.now + bubbleSeconds(text, this.textSpeed) });
    if (tone === 'question') owner.emote = { kind: 'question', until: this.now + 4 };
    return owner.id;
  }

  private visitHelpDesk(name: string): Walker {
    const id = `human:${name}`;
    let w = this.walkers.get(id);
    if (!w || w.leaving) {
      const door = tileFeet(STATIONS.door[1]!);
      w = this.newWalker(id, name, 'human', door.x, door.y, lookFor(name, null));
      this.walkers.set(id, w);
      this.cue('door');
      w.spot = HELPDESK_STAFF;
      this.route(w, HELPDESK_STAFF);
    }
    w.leaveAt = this.now + 14;
    return w;
  }

  private newWalker(id: string, name: string, kind: Walker['kind'], x: number, y: number, look: Look): Walker {
    return {
      id,
      name,
      kind,
      look,
      roleKey: null,
      taskKey: null,
      x,
      y,
      path: [],
      dir: 'up',
      walked: 0,
      station: null,
      spot: null,
      working: false,
      emote: null,
      pokes: 0,
      lastPoke: -99,
      shakeUntil: 0,
      hopUntil: 0,
      leaving: false,
      leaveAt: null,
    };
  }

  private route(w: { x: number; y: number; path: Array<{ x: number; y: number }> }, to: { x: number; y: number }): void {
    const path = findPath(tileOf(w.x, w.y), to);
    w.path = path ? path.slice(1) : [to];
  }

  private leave(w: Walker): void {
    w.leaving = true;
    w.working = false;
    w.station = null;
    const door = STATIONS.door[0]!;
    w.spot = door;
    this.route(w, door);
  }

  // --- Poking ---------------------------------------------------------------

  /** React to a click on someone or something. Returns what was poked, for screen readers. */
  poke(targetId: string): string | null {
    if (targetId === CAT_ID) return this.pokeCat();
    const walker = this.walkers.get(targetId);
    if (walker) return this.pokeWalker(walker);
    const object = OBJECTS.find((o) => o.id === targetId);
    if (object) return this.pokeObject(object.id, object.kind);
    return null;
  }

  private pokeWalker(w: Walker): string {
    w.pokes = this.now - w.lastPoke > POKE_RESET ? 1 : w.pokes + 1;
    w.lastPoke = this.now;
    let text: string;
    let tone: BubbleTone = 'say';
    if (w.kind === 'human') {
      text = pickFrom(['Just answering the agent!', 'Back to my real job soon.', 'Hi there!'], w.pokes);
    } else if (w.pokes === 1) {
      text = w.working ? `Hi! I'm ${w.name}, on ${w.taskKey ?? 'a ceremony'}.` : `Hi! I'm ${w.name}. Waiting for work.`;
      w.emote = { kind: 'alert', until: this.now + 1 };
      this.cue('select');
    } else if (w.pokes === 2) {
      text = 'Yes? I am a bit busy.';
      w.emote = { kind: 'dots', until: this.now + 1.5 };
      this.cue('select');
    } else if (w.pokes === 3) {
      text = 'Please, I am concentrating.';
      w.emote = { kind: 'sweat', until: this.now + 2 };
      this.cue('select');
    } else {
      text = w.pokes === 4 ? 'Hey! Stop poking me!' : pickFrom(["That's going in the retro.", "I'll tell the Scrum Master!", 'Do you want it shipped or not?', 'Grrr!', '*sigh*'], w.pokes + hash(w.name));
      tone = 'shout';
      w.emote = { kind: 'anger', until: this.now + 2.5 };
      w.shakeUntil = this.now + 0.5;
      this.cue('annoyed', 0.9 + Math.min(0.5, w.pokes * 0.05));
    }
    this.bubbles.set(w.id, { ownerId: w.id, text, tone, started: this.now, until: this.now + bubbleSeconds(text, this.textSpeed) });
    return `${w.name}: ${text}`;
  }

  private pokeObject(id: string, kind: ObjectKind): string {
    const state = this.objects.get(id) ?? { count: 0, last: -99, until: 0 };
    state.count = this.now - state.last > 20 ? 1 : state.count + 1;
    state.last = this.now;
    const s = this.stats;
    const n = state.count;
    let text: string;
    let duration = 0.8;
    switch (kind) {
      case 'duck':
        text = n % 5 === 0 ? 'Have you tried explaining the bug to me?' : 'Squeak!';
        this.cue('squeak', 1 + (n % 3) * 0.12);
        duration = 0.6;
        break;
      case 'coffee':
        text = n === 1 ? 'Brewing... *gurgle*' : pickFrom(['Fresh coffee!', 'Decaf? Never heard of it.', 'Another cup? Respect.'], n);
        this.cue('brew');
        duration = 2.6;
        break;
      case 'water':
        text = pickFrom(['Glug glug.', 'Stay hydrated!', '*bloop*'], n);
        this.cue('glug');
        duration = 1.2;
        break;
      case 'plant':
        text = pickFrom(['*rustle*', "I'm photosynthesising here.", 'A little water would be nice.', 'Leaf me alone!'], n - 1);
        this.cue('rustle');
        break;
      case 'printer':
        if (n >= 4) {
          text = 'Fixed it! Printing... done.';
          this.cue('paper');
          state.count = 0;
          duration = 1.2;
        } else {
          text = pickFrom(['Paper jam. Classic.', 'Error: out of cyan. I only print black.', 'PRINTING... just kidding.'], n - 1);
          this.cue('jam');
          duration = 2;
        }
        break;
      case 'bell': {
        const waiting = s.blocked ?? 0;
        text = waiting > 0 ? `${waiting} item${waiting === 1 ? '' : 's'} need${waiting === 1 ? 's' : ''} your answer!` : 'Nothing needs you right now.';
        this.cue('ding');
        break;
      }
      case 'gong': {
        const done = s.done ?? 0;
        text = done > 0 ? `${done} item${done === 1 ? '' : 's'} shipped! BONG!` : 'Nothing shipped yet. Soon!';
        this.cue('gong');
        duration = 1.6;
        break;
      }
      case 'server':
        text = pickFrom(['All systems green.', 'Beep boop. Deploying vibes.', 'Uptime: 100% (today).'], n - 1);
        this.cue('beep');
        duration = 1.5;
        break;
      case 'kanban':
        text = `To Do ${s.todo ?? 0} · Doing ${s.in_progress ?? 0} · Review ${s.review ?? 0} · QA ${s.testing ?? 0} · Done ${s.done ?? 0}`;
        this.cue('paper');
        break;
      case 'trophies': {
        const done = s.done ?? 0;
        text = done === 0 ? 'An empty shelf. Ship something!' : `${done} ${done === 1 ? 'trophy' : 'trophies'}. Keep shipping!`;
        this.cue('jingle');
        break;
      }
    }
    state.until = this.now + duration;
    this.objects.set(id, state);
    this.bubbles.set(id, { ownerId: id, text, tone: 'object', started: this.now, until: this.now + bubbleSeconds(text, this.textSpeed) });
    return text;
  }

  private pokeCat(): string {
    const c = this.cat;
    c.pokes = this.now - c.lastPoke > 5 ? 1 : c.pokes + 1;
    c.lastPoke = this.now;
    c.sleepingUntil = 0;
    const angry = c.pokes >= 3;
    const text = angry ? 'Hiss!' : pickFrom(['Meow?', 'Mrrp.', 'Meow!'], c.pokes);
    this.cue(angry ? 'hiss' : 'meow', 1 + this.random() * 0.2);
    c.emote = { kind: angry ? 'anger' : 'heart', until: this.now + 1.5 };
    // Run off: further when annoyed.
    const tiles = [...zoneTiles(angry ? 'hall' : 'lounge'), ...(angry ? [] : zoneTiles('hall').filter((t) => t.y >= 13))];
    const target = tiles[Math.floor(this.random() * tiles.length)];
    if (target) {
      this.route(c, target);
      c.speed = angry ? 110 : 70;
    }
    c.nextMoveAt = this.now + 4;
    this.bubbles.set(CAT_ID, { ownerId: CAT_ID, text, tone: angry ? 'shout' : 'object', started: this.now, until: this.now + 1.8 });
    return `Cat: ${text}`;
  }

  // --- Time -----------------------------------------------------------------

  update(dt: number): void {
    this.now += dt;
    for (const w of [...this.walkers.values()]) {
      this.move(w, dt, WALK_SPEED);
      if (w.emote && w.emote.until < this.now) w.emote = null;
      if (w.kind === 'human' && w.leaveAt !== null && this.now > w.leaveAt && !w.leaving) this.leave(w);
      if (w.leaving && w.path.length === 0) {
        this.walkers.delete(w.id);
        this.bubbles.delete(w.id);
      }
    }
    this.updateCat(dt);
    for (const [id, b] of this.bubbles) if (b.until < this.now) this.bubbles.delete(id);
  }

  private move(w: Walker | Cat, dt: number, speed: number): void {
    let budget = speed * dt;
    while (budget > 0 && w.path.length > 0) {
      const next = tileFeet(w.path[0]!);
      const dx = next.x - w.x;
      const dy = next.y - w.y;
      const dist = Math.hypot(dx, dy);
      if ('dir' in w && typeof w.dir === 'string') {
        if (Math.abs(dx) > Math.abs(dy)) w.dir = dx < 0 ? 'left' : 'right';
        else if (dy !== 0 && 'look' in w) w.dir = dy < 0 ? 'up' : 'down';
      }
      if (dist <= budget) {
        w.x = next.x;
        w.y = next.y;
        w.path.shift();
        budget -= dist;
      } else {
        w.x += (dx / dist) * budget;
        w.y += (dy / dist) * budget;
        budget = 0;
      }
      const before = Math.floor(w.walked / TILE);
      w.walked += Math.min(dist, speed * dt);
      if ('look' in w && w.kind === 'agent' && Math.floor(w.walked / TILE) !== before) this.cue('step', 0.9 + (hash(w.name) % 5) * 0.05);
    }
    if ('look' in w && w.path.length === 0 && w.spot) w.dir = w.spot.face;
  }

  private updateCat(dt: number): void {
    const c = this.cat;
    this.move(c, dt, c.speed);
    if (c.emote && c.emote.until < this.now) c.emote = null;
    if (c.path.length > 0 || this.now < c.nextMoveAt || this.now < c.sleepingUntil) return;
    c.speed = 26;
    if (this.random() < 0.35) {
      c.sleepingUntil = this.now + 8 + this.random() * 10;
      c.emote = { kind: 'sleep', until: c.sleepingUntil };
      c.nextMoveAt = c.sleepingUntil + 1;
      return;
    }
    const tiles = [...zoneTiles('lounge'), ...zoneTiles('hall').filter((t) => t.y >= 13 && t.x < 22)];
    const target = tiles[Math.floor(this.random() * tiles.length)];
    if (target) this.route(c, target);
    c.nextMoveAt = this.now + 4 + this.random() * 6;
  }

  get catSleeping(): boolean {
    return this.now < this.cat.sleepingUntil && this.cat.path.length === 0;
  }

  // --- Input ----------------------------------------------------------------

  /** What is under a point in world pixels: a person, the cat or an object. */
  hitTest(x: number, y: number): string | null {
    const people = [...this.walkers.values()].sort((a, b) => b.y - a.y);
    for (const w of people) if (x >= w.x - 7 && x <= w.x + 7 && y >= w.y - 25 && y <= w.y + 1) return w.id;
    if (x >= this.cat.x - 7 && x <= this.cat.x + 7 && y >= this.cat.y - 10 && y <= this.cat.y + 1) return CAT_ID;
    for (const o of OBJECTS) if (x >= o.x * TILE && x < (o.x + o.w) * TILE && y >= o.y * TILE - 8 && y < (o.y + o.h) * TILE) return o.id;
    return null;
  }

  /** Everything that can be poked, in reading order, for keyboard play. */
  targets(): Array<{ id: string; label: string; x: number; y: number }> {
    const list = [
      ...[...this.walkers.values()].map((w) => ({ id: w.id, label: w.kind === 'human' ? `${w.name} (you)` : w.name, x: w.x, y: w.y - 26 })),
      { id: CAT_ID, label: 'Office cat', x: this.cat.x, y: this.cat.y - 11 },
      ...OBJECTS.map((o) => ({ id: o.id, label: o.label, x: (o.x + o.w / 2) * TILE, y: o.y * TILE - 2 })),
    ];
    return list.sort((a, b) => Math.floor(a.y / TILE) - Math.floor(b.y / TILE) || a.x - b.x);
  }

  /** Where a bubble owned by `id` points to (above a head or an object). */
  anchorOf(id: string): { x: number; y: number } | null {
    const w = this.walkers.get(id);
    if (w) return { x: w.x, y: w.y - 27 };
    if (id === CAT_ID) return { x: this.cat.x, y: this.cat.y - 11 };
    const o = OBJECTS.find((ob) => ob.id === id);
    return o ? { x: (o.x + o.w / 2) * TILE, y: o.y * TILE - 4 } : null;
  }

  cue(cue: SfxCue, pitch?: number): void {
    if (this.cues.length < 24) this.cues.push({ cue, pitch });
  }

  /** Sounds requested since the last call. */
  drainCues(): Array<{ cue: SfxCue; pitch?: number }> {
    const list = this.cues;
    this.cues = [];
    return list;
  }
}

function pickFrom<T>(list: readonly T[], n: number): T {
  return list[((n % list.length) + list.length) % list.length]!;
}
