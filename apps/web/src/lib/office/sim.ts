// The agent office simulation: who walks where, who says what, and how things react when poked.
// The office has one character per role. An agent "plays" a role by driving that character: it
// walks to where the work is and talks; when the agent moves on to another role, the next
// character takes over. Pure state + time steps, no DOM, so it can be tested and drawn by any
// renderer.
import type { StageId } from '../flow/model';
import { lookFor, roleCharacter, type Dir, type Look } from './characters';
import { hash, TILE } from './pixels';
import {
  BUG_HUNT_AREA,
  CHAT_CORNERS,
  COOLER_CORNER,
  findPath,
  HELPDESK_STAFF,
  HOBBIES,
  HOT_DESKS,
  OBJECTS,
  PASTIME_SPOTS,
  PATROL_ROUTE,
  ROLE_STATIONS,
  STATIONS,
  stationFor,
  walkable,
  zoneTiles,
  type ObjectKind,
  type PastimeKind,
  type Spot,
  type StationId,
} from './world';
import { isCeremony } from '../flow/model';

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
  | 'select'
  | 'purr';
export type BubbleTone = 'say' | 'question' | 'answer' | 'shout' | 'object';

/** A role in the office cast. */
export interface CastRole {
  key: string;
  name: string;
  color: string | null;
}

/** One line said during a pastime: by the character itself, or by an object (the rubber duck). */
export interface PastimeLine {
  by: 'me' | 'duck';
  text: string;
}

/** Something an idle character does: play, have a coffee, chat, nap, or a hobby of its role. */
export interface Pastime {
  kind: PastimeKind;
  spot: Spot;
  until: number;
  /** The conversation this character is part of (chats only). */
  chat: string | null;
  /** Set once the character has reached the spot: lines and effects start then. */
  arrived?: boolean;
  /** What is said during the pastime, in order, and how far it got. */
  script?: readonly PastimeLine[];
  line?: number;
  nextAt?: number;
  /** Stops still ahead on a round (patrol, bug hunt). */
  stops?: Spot[];
}

interface Conversation {
  id: string;
  corner: number;
  members: string[];
  script: readonly string[];
  line: number;
  nextAt: number;
}

/** Little office conversations idle characters have with each other. */
export const CONVERSATIONS: ReadonlyArray<readonly string[]> = [
  ['Did the build pass?', 'Green across the board!', 'Ship it!'],
  ['Who moved my stapler?', 'The cat did.', 'Classic cat.'],
  ['Tabs or spaces?', 'Whatever the linter says.', 'Wise.'],
  ["How's the sprint going?", 'On track, I think.', "Let's not jinx it."],
  ['Coffee or tea?', 'Coffee. Always coffee.', 'Same.'],
  ['Did you write tests for that?', 'Of course!', '...mostly.'],
  ['I dreamt about merge conflicts.', "That's a nightmare, not a dream."],
  ['Retro idea: more snacks.', 'Seconded!', 'Thirded!'],
  ['Have you seen the burndown?', 'It looks like a ski slope.', 'A good one, I hope.'],
  ["Friday deploy?", 'Absolutely not.', 'Just checking.'],
];

/** Gossip at the water cooler. */
export const COOLER_CONVERSATIONS: ReadonlyArray<readonly string[]> = [
  ['Did you hear? The cat got promoted.', 'To what?', 'Head of Naps.'],
  ['Is it me, or is the build faster today?', 'Somebody cached something.', 'Bless them.'],
  ['Who keeps refilling the cooler?', 'DevOps. Automated, probably.'],
  ['Big release coming up?', "Shh. Don't say it out loud."],
  ['Rumour has it the duck fixed a bug.', 'It does all the real work.'],
];

/** Talking a bug through with the rubber duck. */
export const DUCK_TALKS: ReadonlyArray<readonly PastimeLine[]> = [
  [
    { by: 'me', text: 'So, duck. The function calls itself...' },
    { by: 'duck', text: 'Squeak.' },
    { by: 'me', text: '...and nothing ever stops it. Oh!' },
    { by: 'duck', text: 'Squeak!' },
    { by: 'me', text: 'Thanks, duck. You are the best.' },
  ],
  [
    { by: 'me', text: 'This test passes on my machine.' },
    { by: 'duck', text: 'Squeak?' },
    { by: 'me', text: '...because my machine has the cache. Of course.' },
  ],
  [
    { by: 'me', text: 'Let me explain the bug from the start.' },
    { by: 'duck', text: '...' },
    { by: 'me', text: 'Wait. I just found it.' },
    { by: 'duck', text: 'Squeak!' },
  ],
];

/** What characters say once they get to their hobby or chore (one set is picked). */
const PASTIME_TALK: Partial<Record<PastimeKind, ReadonlyArray<readonly string[]>>> = {
  plants: [['There you go, little one.'], ['Grow, my leafy friend!'], ['Someone forgot you again, huh?']],
  cat: [['Who is a good cat?', 'Yes you are!'], ['Hello, boss.'], ['Purr machine activated.']],
  whiteboard: [['Boxes...', '...arrows...', '...more arrows. Perfect.'], ['What if... a queue?', 'No. Simpler.']],
  easel: [['A little more blush pink.', 'Happy little gradients.'], ['Glassy, but readable.']],
  servers: [['Checking the logs...', 'All green. As always.'], ['Rack two looks happy today.']],
  reading: [['Chapter three: the backlog strikes back.'], ['This style guide has a typo...']],
  trophies: [['Polishing our wins.', 'This one is my favourite.'], ['Room for one more!']],
};

/** What characters say at the stops of their rounds (now and then). */
const PATROL_LINES = ['All clear.', 'Doors locked.', 'Nothing suspicious... except the cat.', 'Badge, please. Oh, it is you.'] as const;
const BUG_LINES = ['Got one!', 'It got away...', 'Off-by-one bug, caught!', 'Shh... there it is.'] as const;

/** What a character says about its role when poked at its desk with nothing to do. */
const IDLE_LINES: Readonly<Record<string, readonly string[]>> = {
  project_manager: ['Grooming the backlog in my head.', 'Nothing to plan right now.'],
  architect: ['Thinking in boxes and arrows.', 'Sketching the next big refactor.'],
  ui_designer: ['Picking a nicer shade of purple.', 'Sketching ideas while I wait.'],
  senior_developer: ['Ready for the tricky ones.', 'Refactoring in my head.'],
  backend_developer: ['Tuning a query in my head.', 'The APIs are quiet right now.'],
  frontend_developer: ['Nudging pixels while I wait.', 'Checking the layout on my phone.'],
  code_reviewer: ['Nothing to review yet.', 'My red pen is ready.'],
  qa_engineer: ['No bugs to hunt right now.', 'Sharpening my bug net.'],
  devops_engineer: ['Watching the dashboards.', 'All pipelines are green.'],
  security_engineer: ['Checking the locks.', 'Nobody gets past me.'],
  tech_writer: ['Polishing the docs.', 'Hunting for typos.'],
};
const GENERIC_IDLE = ['Waiting for the next item.', 'All caught up!', 'Need anything?'] as const;

/** What a character says when poked during a pastime. */
const PASTIME_LINES: Readonly<Record<PastimeKind, readonly string[]>> = {
  console: ['Shh, boss level!', 'Just one more round.', 'High score incoming!'],
  arcade: ['Insert coin!', 'Beat my high score if you can.', 'Pew pew!'],
  coffee: ['Coffee keeps the bugs away.', 'Want a cup?', 'Recharging.'],
  chat: ['We were just talking about the retro.', 'Join us!', 'Office gossip: the cat runs this place.'],
  help: ['I asked you something! Check Needs Human.', 'Waiting for your answer.', 'Any news on my question?'],
  nap: ['Zzz... five more minutes.', '*snore*'],
  plants: ['Watering the plants.', 'They grow faster when I talk to them.'],
  cat: ['Shh, the cat is purring.', 'Best colleague in the office.'],
  duck: ['Explaining a bug to the duck.', 'The duck knows things.'],
  whiteboard: ['Sketching the architecture.', 'Do not erase this!'],
  easel: ['Sketching some ideas.', 'Art takes time.'],
  servers: ['Just checking the servers.', 'Blinking lights are calming.'],
  patrol: ['On patrol. Move along.', 'Everything is locked tight.'],
  bughunt: ['Hunting bugs. Literally.', 'Shh, you will scare them.'],
  reading: ['Reading. Do not spoil the ending.', 'Docs are underrated.'],
  trophies: ['Polishing the trophies.', 'We earned every one.'],
};

/** How long each solo pastime lasts: [shortest, longest] seconds. */
const PASTIME_SECONDS: Partial<Record<PastimeKind, [number, number]>> = {
  coffee: [12, 20],
  console: [20, 40],
  arcade: [20, 40],
  nap: [25, 40],
  plants: [9, 13],
  cat: [10, 14],
  duck: [14, 20],
  whiteboard: [20, 30],
  easel: [20, 30],
  servers: [12, 18],
  reading: [25, 35],
  trophies: [12, 16],
  patrol: [70, 70],
  bughunt: [40, 40],
};

/** Solo pastimes anyone can pick, with how often. */
const SOLO_PASTIMES: ReadonlyArray<[Exclude<PastimeKind, 'chat' | 'help'>, number]> = [
  ['console', 26],
  ['coffee', 16],
  ['arcade', 12],
  ['nap', 10],
  ['plants', 10],
  ['cat', 12],
  ['duck', 14],
];

/** The agent currently playing a role character. */
export interface Driver {
  agentName: string;
  stage: StageId;
  taskKey: string | null;
}

export interface Walker {
  id: string;
  /** Role name for role characters, the person's name for people at the help desk. */
  name: string;
  kind: 'role' | 'human';
  look: Look;
  roleKey: string | null;
  /** Where this character works when nobody needs it elsewhere (null for extra copies and people). */
  home: Spot | null;
  /** A second copy of a role, for when several agents play it at once. */
  extra: boolean;
  driver: Driver | null;
  taskKey: string | null;
  /** What the character does while its role has no work. */
  pastime: Pastime | null;
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

  // --- The cast -------------------------------------------------------------

  private cast: CastRole[] = [];
  private nextPastimeAt = 8;
  private conversations: Conversation[] = [];
  private conversationSeq = 0;

  /** The roles of the project: one character each, already at their desks. */
  setCast(roles: CastRole[]): void {
    this.cast = roles;
    const used = new Set<string>();
    const tile = (s: Spot) => `${s.x},${s.y}`;
    const homes = new Map<string, Spot>();
    for (const role of roles) {
      const own = ROLE_STATIONS[role.key];
      const spot = own ? STATIONS[own][0] : undefined;
      if (spot && !used.has(tile(spot))) {
        homes.set(role.key, spot);
        used.add(tile(spot));
      }
    }
    // Roles without a workplace of their own (custom roles) get the free hot desks.
    for (const role of roles) {
      if (homes.has(role.key)) continue;
      const spot = HOT_DESKS.find((d) => !used.has(tile(d))) ?? HOT_DESKS[0]!;
      homes.set(role.key, spot);
      used.add(tile(spot));
    }
    for (const role of roles) {
      const id = `role:${role.key}`;
      const home = homes.get(role.key)!;
      const existing = this.walkers.get(id);
      if (existing) {
        existing.name = role.name;
        existing.look = roleCharacter(role);
        existing.home = home;
      } else {
        const at = tileFeet(home);
        const w = this.newWalker(id, role.name, 'role', at.x, at.y, roleCharacter(role));
        w.roleKey = role.key;
        w.home = home;
        w.spot = home;
        w.dir = home.face;
        this.walkers.set(id, w);
      }
    }
    const keys = new Set(roles.map((r) => r.key));
    for (const w of this.walkers.values()) if (w.kind === 'role' && !w.extra && w.roleKey && !keys.has(w.roleKey)) this.leave(w);
    this.plan();
  }

  /** Hand each role character to the agent playing that role right now. */
  sync(agents: SimAgent[]): void {
    const drivers = new Map<string, SimAgent[]>();
    for (const a of [...agents].sort((x, y) => x.id.localeCompare(y.id))) {
      if (!a.roleKey || !a.working) continue;
      drivers.set(a.roleKey, [...(drivers.get(a.roleKey) ?? []), a]);
    }
    const driven = new Set<string>();
    for (const [roleKey, list] of drivers) {
      list.forEach((a, i) => {
        const id = i === 0 ? `role:${roleKey}` : `role:${roleKey}#${i + 1}`;
        let w = this.walkers.get(id);
        if (!w || w.leaving) {
          // A role without a character (e.g. one added after the office opened), or a second
          // agent in the same role: someone new walks in.
          const role = this.cast.find((r) => r.key === roleKey) ?? { key: roleKey, name: roleKey.replace(/_/g, ' '), color: a.roleColor };
          const door = tileFeet(STATIONS.door[i % STATIONS.door.length]!);
          w = this.newWalker(id, role.name, 'role', door.x, door.y, roleCharacter(role, i + 1));
          w.roleKey = roleKey;
          w.extra = i > 0 || !this.cast.some((r) => r.key === roleKey);
          this.walkers.set(id, w);
          this.cue('door');
        }
        if (!w.driver || w.driver.agentName !== a.name) {
          w.emote = { kind: 'sparkle', until: this.now + 1.2 };
          this.cue('poof');
        }
        w.driver = { agentName: a.name, stage: a.stage, taskKey: a.taskKey };
        w.taskKey = a.taskKey;
        w.pastime = null; // work comes first
        driven.add(id);
      });
    }
    for (const w of this.walkers.values()) {
      if (w.kind !== 'role' || driven.has(w.id)) continue;
      w.driver = null;
      w.taskKey = null;
      if (w.extra && !w.leaving) this.leave(w);
    }
    this.plan();
  }

  /** True while an agent is running a Scrum ceremony: the whole team joins the meeting. */
  get inMeeting(): boolean {
    return [...this.walkers.values()].some((w) => w.driver && isCeremony(w.driver.stage));
  }

  /** Decide where every role character should be, and send those who need to move on their way. */
  private plan(): void {
    const tile = (s: Spot) => `${s.x},${s.y}`;
    const taken = new Set<string>();
    const order = new Map(this.cast.map((r, i) => [r.key, i]));
    const cast = [...this.walkers.values()]
      .filter((w) => w.kind === 'role' && !w.leaving)
      .sort((a, b) => (order.get(a.roleKey ?? '') ?? 99) - (order.get(b.roleKey ?? '') ?? 99) || a.id.localeCompare(b.id));
    const meeting = this.inMeeting;
    const free = (spots: readonly Spot[]) => spots.find((s) => !taken.has(tile(s))) ?? spots[0]!;
    const targets = new Map<Walker, { spot: Spot; station: StationId | null }>();
    const homeStation = (w: Walker): StationId | null => {
      if (!w.home) return null;
      const at = (id: StationId) => STATIONS[id].some((s) => s.x === w.home!.x && s.y === w.home!.y);
      // The role's own desk first: several stations can share a seat (e.g. the workshop desks).
      const own = w.roleKey ? ROLE_STATIONS[w.roleKey] : undefined;
      if (own && at(own)) return own;
      return (Object.keys(STATIONS) as StationId[]).find(at) ?? null;
    };

    // During a ceremony nobody plays games: everyone without work goes to the meeting.
    if (meeting) for (const w of cast) w.pastime = null;

    // 1. Characters with nothing to do keep their own desk.
    for (const w of cast) {
      if (!w.driver && !meeting && !w.pastime && w.home) {
        targets.set(w, { spot: w.home, station: homeStation(w) });
        taken.add(tile(w.home));
      }
    }
    // 2. Characters an agent is playing go where the work is (their own desk for their role's work).
    for (const w of cast) {
      if (!w.driver) continue;
      const station = stationFor(w.driver.stage, w.roleKey);
      const spot = w.home && station === homeStation(w) ? w.home : free(STATIONS[station]);
      targets.set(w, { spot, station });
      taken.add(tile(spot));
    }
    // 3. During a ceremony everyone else takes a seat in the meeting room.
    for (const w of cast) {
      if (w.driver || !meeting) continue;
      const spot = free(STATIONS.meeting);
      targets.set(w, { spot, station: 'meeting' });
      taken.add(tile(spot));
    }
    // 4. Pastimes: the console, the arcade, the coffee machine or a chat corner.
    for (const w of cast) {
      if (targets.has(w)) continue;
      const spot = w.pastime?.spot ?? w.home ?? STATIONS.lounge[0]!;
      targets.set(w, { spot, station: null });
      taken.add(tile(spot));
    }

    for (const [w, { spot, station }] of targets) {
      w.station = station;
      w.working = Boolean(w.driver);
      if (w.spot?.x === spot.x && w.spot?.y === spot.y) continue;
      w.spot = spot;
      this.route(w, spot);
    }
  }

  /** Someone speaks: the character of the role they spoke in, or a person at the help desk. */
  say(speaker: { name: string; kind: 'agent' | 'user' | 'system'; roleKey?: string | null }, text: string, tone: BubbleTone = 'say'): string | null {
    let owner: Walker | undefined;
    if (speaker.kind === 'agent') {
      const all = [...this.walkers.values()].filter((w) => w.kind === 'role' && !w.leaving);
      const playing = all.filter((w) => w.driver?.agentName === speaker.name);
      owner =
        (speaker.roleKey ? playing.find((w) => w.roleKey === speaker.roleKey) : undefined) ??
        (speaker.roleKey ? all.find((w) => w.id === `role:${speaker.roleKey}`) : undefined) ??
        playing[0];
    } else if (speaker.kind === 'user') {
      owner = this.visitHelpDesk(speaker.name);
    }
    if (!owner) return null;
    this.bubbles.set(owner.id, { ownerId: owner.id, text, tone, started: this.now, until: this.now + bubbleSeconds(text, this.textSpeed) });
    if (tone === 'question') {
      owner.emote = { kind: 'question', until: this.now + 4 };
      // A question for a person: the character waits at the help desk (unless an agent needs it).
      if (owner.kind === 'role' && !owner.driver && !this.inMeeting) {
        const taken = new Set([...this.walkers.values()].flatMap((w) => (w !== owner && w.pastime ? [`${w.pastime.spot.x},${w.pastime.spot.y}`] : [])));
        const spot = PASTIME_SPOTS.help.find((s) => !taken.has(`${s.x},${s.y}`)) ?? PASTIME_SPOTS.help[0]!;
        owner.pastime = { kind: 'help', spot, until: this.now + 20, chat: null };
        this.plan();
      }
    }
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
      home: null,
      extra: false,
      driver: null,
      taskKey: null,
      pastime: null,
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
    w.driver = null;
    w.station = null;
    const door = STATIONS.door[0]!;
    w.spot = door;
    this.route(w, door);
  }

  /** Idle characters at their desks: free to start a pastime. */
  private idleAtDesk(): Walker[] {
    return [...this.walkers.values()].filter((w) => w.kind === 'role' && !w.extra && !w.leaving && !w.driver && !w.pastime && w.path.length === 0);
  }

  /** Now and then idle characters play, fetch a coffee or chat; then they go back to their desks. */
  private updatePastimes(): void {
    let changed = false;
    for (const w of this.walkers.values()) {
      const p = w.pastime;
      if (p && (w.driver || p.until <= this.now)) {
        if (p.kind === 'nap' && w.emote?.kind === 'sleep') w.emote = null;
        if (p.kind === 'cat' && p.arrived && !w.driver) this.catFollows(w);
        w.pastime = null;
        changed = true;
      }
    }
    changed = this.updateConversations() || changed;
    changed = this.updatePastimeScripts() || changed;

    if (this.now >= this.nextPastimeAt) {
      this.nextPastimeAt = this.now + 8 + this.random() * 16;
      if (!this.inMeeting) changed = this.startPastime() || changed;
    }
    if (changed) this.plan();
  }

  private startPastime(): boolean {
    const idle = this.idleAtDesk();
    if (idle.length === 0) return false;
    const pick = () => idle.splice(Math.floor(this.random() * idle.length), 1)[0]!;
    const roll = this.random();

    if (roll < 0.3 && idle.length >= 2) {
      const usedCorners = new Set(this.conversations.map((c) => c.corner));
      const free = CHAT_CORNERS.map((_, i) => i).filter((i) => !usedCorners.has(i));
      if (free.length > 0) {
        const corner = free[Math.floor(this.random() * free.length)]!;
        const seats = CHAT_CORNERS[corner]!;
        const size = Math.min(seats.length, idle.length >= 3 && this.random() < 0.4 ? 3 : 2);
        const members = Array.from({ length: size }, pick);
        const id = `chat-${++this.conversationSeq}`;
        members.forEach((w, i) => {
          w.pastime = { kind: 'chat', spot: seats[i]!, until: this.now + 60, chat: id };
        });
        const pool = corner === COOLER_CORNER ? COOLER_CONVERSATIONS : CONVERSATIONS;
        const script = pool[Math.floor(this.random() * pool.length)]!;
        this.conversations.push({ id, corner, members: members.map((w) => w.id), script, line: 0, nextAt: this.now + 1 });
        return true;
      }
    }
    const w = pick();
    const hobby = w.roleKey ? HOBBIES[w.roleKey] : undefined;
    if (hobby && this.random() < 0.45 && this.beginPastime(w.id, hobby)) return true;
    let r = this.random() * SOLO_PASTIMES.reduce((sum, [, weight]) => sum + weight, 0);
    const kind = SOLO_PASTIMES.find(([, weight]) => (r -= weight) < 0)?.[0] ?? 'coffee';
    if (!this.beginPastime(w.id, kind)) return false;
    // The console has two controllers: sometimes a colleague joins in.
    if (kind === 'console' && idle.length > 0 && this.random() < 0.5) {
      const partner = pick();
      if (!this.beginPastime(partner.id, 'console')) idle.push(partner);
      else partner.pastime!.until = w.pastime!.until;
    }
    return true;
  }

  /**
   * Starts a pastime for an idle character, if there is room for it (a free spot, the cat nearby).
   * Returns whether it started. Used by the office itself and by tests.
   */
  beginPastime(walkerId: string, kind: Exclude<PastimeKind, 'chat' | 'help'>): boolean {
    const w = this.walkers.get(walkerId);
    if (!w || w.kind !== 'role' || w.driver || w.leaving || this.inMeeting) return false;
    const [shortest, longest] = PASTIME_SECONDS[kind] ?? [12, 20];
    const until = this.now + shortest + this.random() * (longest - shortest);
    const busy = new Set(
      [...this.walkers.values()].flatMap((o) => (o === w ? [] : [o.pastime?.spot, o.working ? o.spot : null].flatMap((s) => (s ? [`${s.x},${s.y}`] : [])))),
    );
    const talk = PASTIME_TALK[kind];
    const script = (lines: readonly string[] | undefined) => (lines ? lines.map((text) => ({ by: 'me' as const, text })) : undefined);
    let pastime: Pastime | null = null;

    if (kind === 'cat') {
      const c = this.cat;
      if (c.path.length > 0 && c.speed > 26) return false; // it is running off: leave it be
      c.path = [];
      const at = tileOf(c.x, c.y);
      const next = (
        [
          [-1, 0, 'right'],
          [1, 0, 'left'],
          [0, 1, 'up'],
          [0, -1, 'down'],
        ] as const
      ).find(([dx, dy]) => walkable(at.x + dx, at.y + dy) && !busy.has(`${at.x + dx},${at.y + dy}`));
      if (!next) return false;
      pastime = { kind, spot: { x: at.x + next[0], y: at.y + next[1], face: next[2] }, until, chat: null };
      c.nextMoveAt = until + 1; // the cat stays for its cuddles
    } else if (kind === 'patrol' || kind === 'bughunt') {
      const stops =
        kind === 'patrol'
          ? PATROL_ROUTE.map((s) => ({ ...s }))
          : Array.from({ length: 4 }, () => {
              const a = BUG_HUNT_AREA;
              return { x: a.x + Math.floor(this.random() * a.w), y: a.y + Math.floor(this.random() * a.h), face: this.random() < 0.5 ? ('left' as const) : ('right' as const) };
            }).filter((s) => walkable(s.x, s.y));
      if (stops.length === 0) return false;
      pastime = { kind, spot: stops.shift()!, until, chat: null, stops };
    } else {
      const spots = PASTIME_SPOTS[kind].filter((s) => !busy.has(`${s.x},${s.y}`));
      if (spots.length === 0) return false;
      const spot = kind === 'plants' ? spots[Math.floor(this.random() * spots.length)]! : spots[0]!;
      const lines = kind === 'duck' ? DUCK_TALKS[Math.floor(this.random() * DUCK_TALKS.length)] : script(talk?.[Math.floor(this.random() * talk.length)]);
      pastime = { kind, spot, until, chat: null, script: lines };
    }
    w.pastime = pastime;
    this.plan();
    return true;
  }

  /** Effects when someone gets to their pastime: a nap begins, a plant drinks, the cat purrs... */
  private arrive(w: Walker, p: Pastime): void {
    p.arrived = true;
    p.line = 0;
    p.nextAt = this.now + 0.6;
    const active = (id: string, until: number) => this.objects.set(id, { ...(this.objects.get(id) ?? { count: 0, last: -99 }), until });
    switch (p.kind) {
      case 'nap':
        w.emote = { kind: 'sleep', until: p.until };
        break;
      case 'plants':
        if (p.spot.object) active(p.spot.object, this.now + 4);
        this.cue('glug', 1.2);
        break;
      case 'cat':
        this.cat.emote = { kind: 'heart', until: p.until };
        this.cue('purr');
        this.bubbles.set(CAT_ID, { ownerId: CAT_ID, text: 'Purrr...', tone: 'object', started: this.now, until: this.now + 2.5 });
        p.nextAt = this.now + 1.8;
        break;
      case 'servers':
        active('servers', p.until);
        break;
      case 'trophies':
        active('trophies', p.until);
        break;
      case 'reading':
        this.cue('paper');
        break;
      case 'patrol':
        if (this.random() < 0.4) this.speak(w, pickFrom(PATROL_LINES, Math.floor(this.random() * PATROL_LINES.length)));
        p.nextAt = this.now + 1.5;
        break;
      case 'bughunt': {
        const r = this.random();
        if (r < 0.5) {
          const text = pickFrom(BUG_LINES, Math.floor(r * 8));
          this.speak(w, text);
          if (text !== 'It got away...') {
            w.emote = { kind: 'sparkle', until: this.now + 1.2 };
            this.cue('chime', 1.3);
          }
        }
        p.nextAt = this.now + 2;
        break;
      }
    }
  }

  private speak(w: Walker, text: string): void {
    this.bubbles.set(w.id, { ownerId: w.id, text, tone: 'say', started: this.now, until: this.now + bubbleSeconds(text, this.textSpeed) * 0.85 });
  }

  /** Lines said during pastimes, and the next stop of a round. Returns whether anyone moves on. */
  private updatePastimeScripts(): boolean {
    let changed = false;
    for (const w of this.walkers.values()) {
      const p = w.pastime;
      if (!p || p.kind === 'chat' || p.kind === 'help' || w.path.length > 0) continue;
      if (!p.arrived) {
        this.arrive(w, p);
        continue;
      }
      if (this.now < (p.nextAt ?? 0)) continue;
      const line = p.script?.[p.line ?? 0];
      if (line) {
        if (line.by === 'duck') {
          this.objects.set('duck', { ...(this.objects.get('duck') ?? { count: 0, last: -99 }), until: this.now + 0.6 });
          this.bubbles.set('duck', { ownerId: 'duck', text: line.text, tone: 'object', started: this.now, until: this.now + bubbleSeconds(line.text, this.textSpeed) * 0.8 });
          if (line.text !== '...') this.cue('squeak', 1.1);
        } else {
          this.speak(w, line.text);
        }
        p.line = (p.line ?? 0) + 1;
        p.nextAt = this.now + 1.2 + line.text.length * 0.05;
      } else if (p.stops) {
        const next = p.stops.shift();
        if (next) {
          p.spot = next;
          p.arrived = false;
        } else {
          p.until = this.now; // the round is done
        }
        changed = true;
      }
    }
    return changed;
  }

  /** After a cuddle the cat sometimes follows its new friend back to the desk. */
  private catFollows(w: Walker): void {
    if (!w.home || this.random() >= 0.4) return;
    const target = [w.home.x + 1, w.home.x - 1].map((x) => ({ x, y: w.home!.y })).find((tile) => walkable(tile.x, tile.y));
    if (!target) return;
    this.route(this.cat, target);
    this.cat.speed = 40;
    this.cat.nextMoveAt = this.now + 12;
    this.cat.emote = { kind: 'heart', until: this.now + 2 };
  }

  /** Characters in a conversation take turns once they have all arrived. */
  private updateConversations(): boolean {
    let changed = false;
    this.conversations = this.conversations.filter((c) => {
      const members = c.members.map((id) => this.walkers.get(id)).filter((w): w is Walker => w?.pastime?.chat === c.id);
      if (members.length < 2 || c.line >= c.script.length + 1) {
        for (const w of members) w.pastime = null;
        changed = true;
        return false;
      }
      if (members.some((w) => w.path.length > 0)) {
        c.nextAt = Math.max(c.nextAt, this.now + 0.6);
        return true;
      }
      if (this.now < c.nextAt) return true;
      if (c.line < c.script.length) {
        const speaker = members[c.line % members.length]!;
        const text = c.script[c.line]!;
        this.bubbles.set(speaker.id, { ownerId: speaker.id, text, tone: 'say', started: this.now, until: this.now + bubbleSeconds(text, this.textSpeed) * 0.8 });
        c.nextAt = this.now + 1.4 + text.length * 0.05;
      } else {
        c.nextAt = this.now + 1.5; // a moment before everyone heads back
      }
      c.line++;
      return true;
    });
    return changed;
  }

  /** The conversations going on right now (for tests and the renderer). */
  get chats(): ReadonlyArray<{ id: string; corner: number; members: string[]; line: number; script: readonly string[] }> {
    return this.conversations;
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
    } else if (w.pastime?.kind === 'nap' && !w.driver && w.pastime.arrived) {
      if (w.pokes === 1) {
        text = pickFrom(PASTIME_LINES.nap, 0);
        this.cue('select', 0.7);
      } else {
        text = "Huh?! I'm up, I'm up!";
        w.pastime = null;
        w.emote = { kind: 'alert', until: this.now + 1.2 };
        w.hopUntil = this.now + 0.4;
        this.cue('select', 1.3);
        this.plan();
      }
    } else if (w.pokes === 1) {
      text = w.driver
        ? `I'm the ${w.name}. ${w.driver.agentName} has me on ${w.taskKey ?? 'a ceremony'}.`
        : w.station === 'meeting'
          ? `I'm the ${w.name}. Shh, meeting in progress.`
          : w.pastime
            ? pickFrom(PASTIME_LINES[w.pastime.kind], 0)
            : `I'm the ${w.name}. ${pickFrom(IDLE_LINES[w.roleKey ?? ''] ?? GENERIC_IDLE, 0)}`;
      w.emote = { kind: 'alert', until: this.now + 1 };
      this.cue('select');
    } else if (w.pokes === 2) {
      text = w.driver ? 'Yes? I am a bit busy.' : w.pastime ? pickFrom(PASTIME_LINES[w.pastime.kind], 1) : pickFrom(IDLE_LINES[w.roleKey ?? ''] ?? GENERIC_IDLE, 1);
      w.emote = { kind: 'dots', until: this.now + 1.5 };
      this.cue('select');
    } else if (w.pokes === 3) {
      text = w.driver ? 'Please, I am concentrating.' : w.pastime ? "I'm on my break, promise!" : 'Still nothing to do, really.';
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
      case 'tv':
        text = pickFrom(['Press START.', 'Player 2 has entered the game!', 'Loading... 99%'], n - 1);
        this.cue('beep');
        duration = 1.5;
        break;
      case 'arcade':
        text = pickFrom(['INSERT COIN', 'HIGH SCORE: 99,999', 'GAME OVER. Play again?'], n - 1);
        this.cue('select');
        duration = 1.5;
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
    this.updatePastimes();
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
      if ('look' in w && w.kind === 'role' && Math.floor(w.walked / TILE) !== before) this.cue('step', 0.9 + (hash(w.name) % 5) * 0.05);
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
      ...[...this.walkers.values()].map((w) => ({ id: w.id, label: labelOf(w), x: w.x, y: w.y - 26 })),
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

/** How a character is named on screen and for screen readers. */
export function labelOf(w: Walker): string {
  if (w.kind === 'human') return `${w.name} (you)`;
  return w.driver ? `${w.name} (${w.driver.agentName})` : w.name;
}

function pickFrom<T>(list: readonly T[], n: number): T {
  return list[((n % list.length) + list.length) % list.length]!;
}
