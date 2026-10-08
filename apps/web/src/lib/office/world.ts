// The agent office map: zones for every SDLC stage, a station for every role, furniture,
// interactive objects and a walkable grid with path finding.
import type { StageId } from '../flow/model';
import type { Dir } from './characters';
import { COLS, ROWS } from './pixels';

export interface TileRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Zone extends TileRect {
  id: string;
  label: string;
  floor: [string, string];
}

/** Floor areas; the first one is the hallway under everything else. */
export const ZONES: readonly Zone[] = [
  { id: 'hall', label: '', x: 1, y: 2, w: 30, h: 15, floor: ['#d9c9a8', '#d2c19e'] },
  { id: 'library', label: 'BACKLOG', x: 1, y: 2, w: 7, h: 6, floor: ['#b98a5e', '#ae8056'] },
  { id: 'meeting', label: 'MEETING ROOM', x: 9, y: 2, w: 9, h: 6, floor: ['#6f86c6', '#6780bf'] },
  { id: 'board', label: 'SPRINT BOARD', x: 19, y: 2, w: 4, h: 3, floor: ['#cdbd98', '#c6b591'] },
  { id: 'help', label: 'HELP DESK', x: 24, y: 2, w: 7, h: 6, floor: ['#f2e3b3', '#eadaa6'] },
  { id: 'workshop', label: 'WORKSHOP', x: 1, y: 9, w: 15, h: 4, floor: ['#9aa3b5', '#939cae'] },
  { id: 'ops', label: 'OPS & SECURITY', x: 16, y: 9, w: 6, h: 4, floor: ['#7d8aa3', '#76839c'] },
  { id: 'review', label: 'REVIEW', x: 22, y: 9, w: 4, h: 4, floor: ['#b49be0', '#ac93d8'] },
  { id: 'qa', label: 'QA LAB', x: 26, y: 9, w: 5, h: 4, floor: ['#e8eef2', '#dfe6eb'] },
  { id: 'lounge', label: 'LOUNGE', x: 1, y: 14, w: 9, h: 3, floor: ['#8fc79a', '#87bf92'] },
  { id: 'dock', label: 'SHIP DOCK', x: 22, y: 14, w: 9, h: 3, floor: ['#c9a36b', '#c19b63'] },
];

export type FurnitureKind =
  | 'shelf'
  | 'desk'
  | 'table'
  | 'counter'
  | 'whiteboardStand'
  | 'easel'
  | 'server'
  | 'bench'
  | 'sofa'
  | 'coffee'
  | 'water'
  | 'plant'
  | 'printer'
  | 'duckDesk'
  | 'trophies'
  | 'gong'
  | 'crates'
  | 'tv'
  | 'arcade';

export interface Furniture extends TileRect {
  id: string;
  kind: FurnitureKind;
  /** Station whose desk this is (its monitor lights up while someone works there). */
  station?: StationId;
}

/** Everything that blocks walking (wall rows 0–1, row 17 and the side columns are solid too). */
export const FURNITURE: readonly Furniture[] = [
  { id: 'shelves', kind: 'shelf', x: 1, y: 2, w: 7, h: 1 },
  { id: 'pm-desk', kind: 'desk', x: 2, y: 5, w: 2, h: 1, station: 'pm_desk' },
  { id: 'writer-desk', kind: 'desk', x: 5, y: 5, w: 2, h: 1, station: 'writer_desk' },
  { id: 'meeting-table', kind: 'table', x: 11, y: 4, w: 5, h: 2 },
  { id: 'help-counter', kind: 'counter', x: 25, y: 4, w: 5, h: 1 },
  { id: 'help-plant', kind: 'plant', x: 30, y: 7, w: 1, h: 1 },
  { id: 'dev-desk-1', kind: 'desk', x: 2, y: 10, w: 2, h: 1, station: 'senior_desk' },
  { id: 'dev-desk-2', kind: 'desk', x: 5, y: 10, w: 2, h: 1, station: 'backend_desk' },
  { id: 'dev-desk-3', kind: 'desk', x: 8, y: 10, w: 2, h: 1, station: 'frontend_desk' },
  { id: 'whiteboard', kind: 'whiteboardStand', x: 11, y: 10, w: 2, h: 1 },
  { id: 'easel', kind: 'easel', x: 14, y: 10, w: 1, h: 1 },
  { id: 'servers', kind: 'server', x: 17, y: 9, w: 2, h: 2 },
  { id: 'security-desk', kind: 'desk', x: 20, y: 10, w: 2, h: 1, station: 'security' },
  { id: 'review-desk', kind: 'desk', x: 23, y: 10, w: 2, h: 1, station: 'review' },
  { id: 'qa-bench', kind: 'bench', x: 27, y: 10, w: 3, h: 1 },
  { id: 'lounge-plant', kind: 'plant', x: 1, y: 14, w: 1, h: 1 },
  { id: 'tv', kind: 'tv', x: 2, y: 14, w: 2, h: 1 },
  { id: 'arcade', kind: 'arcade', x: 5, y: 14, w: 1, h: 1 },
  { id: 'sofa', kind: 'sofa', x: 2, y: 16, w: 3, h: 1 },
  { id: 'coffee', kind: 'coffee', x: 7, y: 14, w: 1, h: 1 },
  { id: 'water', kind: 'water', x: 8, y: 14, w: 1, h: 1 },
  { id: 'printer', kind: 'printer', x: 11, y: 14, w: 1, h: 1 },
  { id: 'duck-desk', kind: 'duckDesk', x: 13, y: 14, w: 2, h: 1 },
  { id: 'hall-plant', kind: 'plant', x: 20, y: 14, w: 1, h: 1 },
  { id: 'trophies', kind: 'trophies', x: 23, y: 14, w: 4, h: 1 },
  { id: 'gong', kind: 'gong', x: 29, y: 14, w: 1, h: 1 },
  { id: 'crates', kind: 'crates', x: 30, y: 16, w: 1, h: 1 },
];

export type StationId =
  | 'pm_desk'
  | 'writer_desk'
  | 'meeting'
  | 'kanban'
  | 'helpdesk'
  | 'dev_desk'
  | 'senior_desk'
  | 'backend_desk'
  | 'frontend_desk'
  | 'whiteboard'
  | 'easel'
  | 'server'
  | 'security'
  | 'review'
  | 'qa'
  | 'dock'
  | 'lounge'
  | 'door';

export interface Spot {
  x: number;
  y: number;
  face: Dir;
}

const row = (y: number, xs: number[], face: Dir): Spot[] => xs.map((x) => ({ x, y, face }));

/** Where people stand at each station, best spot first. */
export const STATIONS: Readonly<Record<StationId, readonly Spot[]>> = {
  pm_desk: row(6, [2, 3], 'up'),
  writer_desk: row(6, [5, 6], 'up'),
  // The host's seat first, then the rest of the team around the table.
  meeting: [
    ...row(3, [13, 11, 15, 12, 14], 'down'),
    ...row(6, [13, 11, 15, 12, 14], 'up'),
    { x: 10, y: 4, face: 'right' },
    { x: 16, y: 4, face: 'left' },
    { x: 10, y: 5, face: 'right' },
    { x: 16, y: 5, face: 'left' },
  ],
  kanban: row(2, [20, 21, 19, 22], 'up'),
  helpdesk: row(5, [26, 28, 27], 'up'),
  // The workshop: one desk per developer role, its own seats first and the rest of the workshop
  // when they are taken (a colleague in the same role); dev_desk is any seat there.
  dev_desk: row(11, [2, 5, 8, 3, 6, 9], 'up'),
  senior_desk: row(11, [2, 3, 5, 6, 8, 9], 'up'),
  backend_desk: row(11, [5, 6, 2, 3, 8, 9], 'up'),
  frontend_desk: row(11, [8, 9, 5, 6, 2, 3], 'up'),
  whiteboard: row(11, [11, 12], 'up'),
  easel: row(11, [14, 15], 'up'),
  server: row(11, [17, 18], 'up'),
  security: row(11, [20, 21], 'up'),
  review: row(11, [23, 24], 'up'),
  qa: row(11, [27, 28, 29], 'up'),
  dock: row(15, [24, 25, 26, 23], 'up'),
  lounge: [...row(15, [2, 3, 4], 'down'), ...row(15, [6, 7], 'down')],
  door: row(16, [15, 16], 'up'),
};

/** What characters do while their role has no work ("help": waiting at the help desk for your answer). */
export type PastimeKind = 'coffee' | 'console' | 'arcade' | 'chat' | 'help';

/** Where each pastime happens. */
export const PASTIME_SPOTS: Readonly<Record<Exclude<PastimeKind, 'chat'>, readonly Spot[]>> = {
  coffee: [
    { x: 7, y: 15, face: 'up' },
    { x: 8, y: 15, face: 'up' },
  ],
  console: row(15, [2, 3], 'up'),
  arcade: [{ x: 5, y: 15, face: 'up' }],
  help: row(5, [26, 28, 27], 'up'),
};

/** Corners where two or three idle characters meet for a chat, facing each other. */
export const CHAT_CORNERS: ReadonlyArray<readonly Spot[]> = [
  [
    { x: 6, y: 8, face: 'right' },
    { x: 8, y: 8, face: 'left' },
    { x: 7, y: 7, face: 'down' },
  ],
  [
    { x: 20, y: 13, face: 'right' },
    { x: 22, y: 13, face: 'left' },
    { x: 21, y: 12, face: 'down' },
  ],
  [
    { x: 10, y: 15, face: 'right' },
    { x: 12, y: 15, face: 'left' },
    { x: 11, y: 16, face: 'up' },
  ],
];

/** Free desks for roles without a workplace of their own (roles added later). */
export const HOT_DESKS: readonly Spot[] = [
  ...row(11, [3, 6, 9], 'up'),
  { x: 6, y: 6, face: 'up' },
  { x: 3, y: 6, face: 'up' },
  ...row(11, [24, 21, 18, 28, 15, 12], 'up'),
];

/** Where a person who answers the agent stands: behind the help desk. */
export const HELPDESK_STAFF: Spot = { x: 27, y: 3, face: 'down' };

/** Each built-in role's own workplace; other roles use the stage's default station. */
export const ROLE_STATIONS: Readonly<Record<string, StationId>> = {
  project_manager: 'pm_desk',
  architect: 'whiteboard',
  ui_designer: 'easel',
  senior_developer: 'senior_desk',
  backend_developer: 'backend_desk',
  frontend_developer: 'frontend_desk',
  code_reviewer: 'review',
  qa_engineer: 'qa',
  devops_engineer: 'server',
  security_engineer: 'security',
  tech_writer: 'writer_desk',
};

const STAGE_STATIONS: Record<StageId, StationId> = {
  kickoff: 'meeting',
  sprint_planning: 'meeting',
  sprint_review: 'meeting',
  backlog: 'pm_desk',
  todo: 'kanban',
  in_progress: 'dev_desk',
  review: 'review',
  testing: 'qa',
  done: 'dock',
  blocked: 'helpdesk',
  lounge: 'lounge',
};

/** The workshop desks: someone working at any workshop seat (dev_desk) counts for each of them. */
export const WORKSHOP_DESKS: ReadonlySet<StationId> = new Set(['senior_desk', 'backend_desk', 'frontend_desk']);

/** The station for an agent in a stage playing a role. Work stages use the role's own desk. */
export function stationFor(stage: StageId, roleKey: string | null): StationId {
  if (stage === 'in_progress' || stage === 'review' || stage === 'testing' || stage === 'backlog') {
    const own = roleKey ? ROLE_STATIONS[roleKey] : undefined;
    if (own) return own;
  }
  return STAGE_STATIONS[stage];
}

// ---------------------------------------------------------------------------
// Walking
// ---------------------------------------------------------------------------

export type Grid = boolean[][]; // [y][x] → walkable

export function buildGrid(): Grid {
  const grid: Grid = Array.from({ length: ROWS }, (_, y) =>
    Array.from({ length: COLS }, (_, x) => y >= 2 && y <= ROWS - 2 && x >= 1 && x <= COLS - 2),
  );
  for (const f of FURNITURE) for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) grid[y]![x] = false;
  return grid;
}

export const GRID = buildGrid();

export const walkable = (x: number, y: number, grid: Grid = GRID): boolean => grid[y]?.[x] === true;

/** Shortest 4-way path between two tiles (both ends included), or null if unreachable. */
export function findPath(from: { x: number; y: number }, to: { x: number; y: number }, grid: Grid = GRID): Array<{ x: number; y: number }> | null {
  if (!walkable(to.x, to.y, grid)) return null;
  const key = (x: number, y: number) => y * COLS + x;
  const cameFrom = new Map<number, number>();
  const start = key(from.x, from.y);
  cameFrom.set(start, -1);
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]!;
    const cx = current % COLS;
    const cy = Math.floor(current / COLS);
    if (cx === to.x && cy === to.y) {
      const path: Array<{ x: number; y: number }> = [];
      for (let k = current; k !== -1; k = cameFrom.get(k)!) path.unshift({ x: k % COLS, y: Math.floor(k / COLS) });
      return path;
    }
    for (const [dx, dy] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      const k = key(nx, ny);
      if (!cameFrom.has(k) && walkable(nx, ny, grid)) {
        cameFrom.set(k, current);
        queue.push(k);
      }
    }
  }
  return null;
}

/** Walkable tiles inside a zone (where the cat may wander). */
export function zoneTiles(zoneId: string): Array<{ x: number; y: number }> {
  const z = ZONES.find((zone) => zone.id === zoneId);
  if (!z) return [];
  const tiles: Array<{ x: number; y: number }> = [];
  for (let y = z.y; y < z.y + z.h; y++) for (let x = z.x; x < z.x + z.w; x++) if (walkable(x, y)) tiles.push({ x, y });
  return tiles;
}

// ---------------------------------------------------------------------------
// Things to click
// ---------------------------------------------------------------------------

export type ObjectKind = 'duck' | 'coffee' | 'plant' | 'printer' | 'water' | 'bell' | 'gong' | 'server' | 'kanban' | 'trophies' | 'tv' | 'arcade';

export interface OfficeObject extends TileRect {
  id: string;
  kind: ObjectKind;
  label: string;
}

export const OBJECTS: readonly OfficeObject[] = [
  { id: 'duck', kind: 'duck', label: 'Rubber duck', x: 14, y: 14, w: 1, h: 1 },
  { id: 'coffee', kind: 'coffee', label: 'Coffee machine', x: 7, y: 14, w: 1, h: 1 },
  { id: 'water', kind: 'water', label: 'Water cooler', x: 8, y: 14, w: 1, h: 1 },
  { id: 'lounge-plant', kind: 'plant', label: 'Office plant', x: 1, y: 14, w: 1, h: 1 },
  { id: 'tv', kind: 'tv', label: 'Game console', x: 2, y: 14, w: 2, h: 1 },
  { id: 'arcade', kind: 'arcade', label: 'Arcade cabinet', x: 5, y: 14, w: 1, h: 1 },
  { id: 'printer', kind: 'printer', label: 'Printer', x: 11, y: 14, w: 1, h: 1 },
  { id: 'bell', kind: 'bell', label: 'Help desk bell', x: 27, y: 4, w: 1, h: 1 },
  { id: 'gong', kind: 'gong', label: 'Release gong', x: 29, y: 14, w: 1, h: 1 },
  { id: 'servers', kind: 'server', label: 'Server rack', x: 17, y: 9, w: 2, h: 2 },
  { id: 'kanban', kind: 'kanban', label: 'Sprint board', x: 19, y: 0, w: 4, h: 2 },
  { id: 'trophies', kind: 'trophies', label: 'Trophy shelf', x: 23, y: 14, w: 4, h: 1 },
];
