import { describe, expect, it } from 'vitest';
import { SYSTEM_ROLE_KEYS, type ActivityDTO, type RemarkDTO } from '@loop/shared';
import { drawCat, drawCharacter, lookFor, ROLE_LOOKS, roleOutfit, type Dir } from './characters';
import { lineFromActivity, lineFromRemark, speech } from './chatter';
import { chordNotes, compileTrack, noteToMidi, parseDrums, parseVoice, STEPS, tokens, TRACKS } from './music';
import { COLS, hash, ROWS, safeColor, shade, TILE, WORLD_H, WORLD_W, type Painter } from './pixels';
import { renderOffice } from './render';
import { DEFAULT_SETTINGS, parseSettings } from './settings';
import { bubbleSeconds, CONVERSATIONS, labelOf, OfficeSim, rng, tileFeet, WALK_SPEED, type CastRole, type SimAgent } from './sim';
import { CHAT_CORNERS, FURNITURE, findPath, GRID, HOT_DESKS, OBJECTS, PASTIME_SPOTS, ROLE_STATIONS, STATIONS, stationFor, walkable, zoneTiles } from './world';

/** A canvas stand-in that records what is drawn. */
function fakePainter(scale = 2) {
  const rects: Array<[number, number, number, number]> = [];
  const texts: string[] = [];
  const ctx = {
    fillStyle: '',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    imageSmoothingEnabled: true,
    fillRect: (x: number, y: number, w: number, h: number) => rects.push([x, y, w, h]),
    fillText: (s: string) => texts.push(s),
    measureText: (s: string) => ({ width: s.length * 3 * scale }),
  } as unknown as CanvasRenderingContext2D;
  const painter: Painter = { ctx, scale, time: 1.5 };
  return { painter, rects, texts };
}

const agent = (over: Partial<SimAgent> = {}): SimAgent => ({
  id: 's1',
  name: 'Claude Code',
  stage: 'in_progress',
  roleKey: 'software_engineer',
  roleColor: '#10b981',
  working: true,
  taskKey: 'SHOP-1',
  ...over,
});

/** Run the simulation until everyone has stopped walking (or a time limit). */
function settle(sim: OfficeSim, seconds = 30) {
  for (let t = 0; t < seconds * 20; t++) sim.update(0.05);
}

describe('pixel helpers', () => {
  it('shades colours, hashes names and validates colours', () => {
    expect(shade('#808080', 0.5)).toBe('#c0c0c0');
    expect(shade('#808080', -0.5)).toBe('#404040');
    expect(shade('not a colour', 0.5)).toBe('not a colour');
    expect(hash('Claude Code')).toBe(hash('Claude Code'));
    expect(hash('Claude Code')).not.toBe(hash('Cursor'));
    expect(safeColor('#10B981', '#000000')).toBe('#10B981');
    expect(safeColor('red; background: url(x)', '#000000')).toBe('#000000');
    expect(WORLD_W).toBe(COLS * TILE);
    expect(WORLD_H).toBe(ROWS * TILE);
  });
});

describe('characters', () => {
  it('gives every built-in role a hand-picked outfit', () => {
    for (const key of SYSTEM_ROLE_KEYS) expect(ROLE_LOOKS[key], key).toBeDefined();
    expect(lookFor('Claude Code', { key: 'qa_engineer', color: '#ec4899' })).toMatchObject({ outfit: 'coat', accessory: 'goggles', prop: 'bugnet', shirt: '#ec4899' });
    expect(lookFor('Claude Code', { key: 'architect', color: '#0ea5e9' })).toMatchObject({ accessory: 'hardhat', prop: 'blueprint' });
  });

  it('dresses roles added later in their own colour, the same way every time', () => {
    const a = lookFor('Cursor', { key: 'data_engineer', color: '#123456' });
    expect(a).toEqual(lookFor('Cursor', { key: 'data_engineer', color: '#123456' }));
    expect(a.shirt).toBe('#123456');
    expect(roleOutfit('data_engineer')).toEqual(roleOutfit('data_engineer'));
    const combos = new Set(Array.from({ length: 30 }, (_, i) => JSON.stringify(roleOutfit(`custom_role_${i}`))));
    expect(combos.size).toBeGreaterThan(10); // custom roles look different from each other
    expect(lookFor('Cursor', { key: 'odd_role', color: 'javascript:alert(1)' }).shirt).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('keeps who someone is across roles, and tells agents apart', () => {
    const engineer = lookFor('Claude Code', { key: 'software_engineer', color: '#10b981' });
    const reviewer = lookFor('Claude Code', { key: 'code_reviewer', color: '#f59e0b' });
    expect([engineer.skin, engineer.hair, engineer.hairStyle]).toEqual([reviewer.skin, reviewer.hair, reviewer.hairStyle]);
    const names = ['Claude Code', 'Cursor', 'VS Code', 'Codex', 'Windsurf', 'Zed'];
    const identities = new Set(names.map((n) => JSON.stringify(lookFor(n, null)).slice(0, 80)));
    expect(identities.size).toBeGreaterThan(3);
    expect(lookFor('Ada', null)).toMatchObject({ prop: 'mug', accessory: 'none' });
  });

  it('draws every role in every direction and walk frame inside its 16 × 24 box', () => {
    const { painter, rects } = fakePainter(1);
    const roles = [...SYSTEM_ROLE_KEYS, 'custom_a', 'custom_b'];
    for (const key of roles) {
      for (const dir of ['down', 'up', 'left', 'right'] as Dir[]) {
        for (let frame = 0; frame < 4; frame++) {
          rects.length = 0;
          drawCharacter(painter, lookFor(key, { key, color: '#336699' }), 100, 100, { dir, frame, working: frame % 2 === 0 });
          expect(rects.length).toBeGreaterThan(12);
          for (const [x, y, w, h] of rects) {
            expect(x, `${key} ${dir}`).toBeGreaterThanOrEqual(100 - 9);
            expect(x + w, `${key} ${dir}`).toBeLessThanOrEqual(100 + 9);
            expect(y, `${key} ${dir}`).toBeGreaterThanOrEqual(100 - 26);
            expect(y + h).toBeLessThanOrEqual(100 + 1);
          }
        }
      }
    }
    expect(() => drawCat(painter, 50, 50, 'right', 1, false)).not.toThrow();
    expect(() => drawCat(painter, 50, 50, 'left', 0, true)).not.toThrow();
  });
});

describe('office map', () => {
  it('has a reachable, walkable spot for every station', () => {
    const door = STATIONS.door[0]!;
    for (const [id, spots] of Object.entries(STATIONS)) {
      expect(spots.length, id).toBeGreaterThan(0);
      for (const s of spots) {
        expect(walkable(s.x, s.y), `${id} ${s.x},${s.y}`).toBe(true);
        expect(findPath(door, s), `${id} ${s.x},${s.y}`).not.toBeNull();
      }
    }
  });

  it('can reach every pastime spot, chat corner and hot desk', () => {
    const door = STATIONS.door[0]!;
    for (const s of [...Object.values(PASTIME_SPOTS).flat(), ...CHAT_CORNERS.flat(), ...HOT_DESKS]) {
      expect(walkable(s.x, s.y), `${s.x},${s.y}`).toBe(true);
      expect(findPath(door, s), `${s.x},${s.y}`).not.toBeNull();
    }
  });

  it('keeps furniture inside the room and apart', () => {
    const cells = new Set<string>();
    for (const f of FURNITURE) {
      expect(f.x, f.id).toBeGreaterThanOrEqual(1);
      expect(f.y, f.id).toBeGreaterThanOrEqual(2);
      expect(f.x + f.w, f.id).toBeLessThanOrEqual(COLS - 1);
      expect(f.y + f.h, f.id).toBeLessThanOrEqual(ROWS - 1);
      for (let y = f.y; y < f.y + f.h; y++)
        for (let x = f.x; x < f.x + f.w; x++) {
          expect(cells.has(`${x},${y}`), `${f.id} overlaps at ${x},${y}`).toBe(false);
          cells.add(`${x},${y}`);
        }
    }
    expect(GRID[0]![5]).toBe(false); // the wall
    expect(walkable(15, 8)).toBe(true); // the hallway
  });

  it('sends each role to its own workplace and stages to theirs', () => {
    for (const key of SYSTEM_ROLE_KEYS) expect(ROLE_STATIONS[key], key).toBeDefined();
    expect(stationFor('in_progress', 'ui_designer')).toBe('easel');
    expect(stationFor('in_progress', 'brand_new_role')).toBe('dev_desk');
    expect(stationFor('review', 'code_reviewer')).toBe('review');
    expect(stationFor('testing', null)).toBe('qa');
    expect(stationFor('backlog', 'project_manager')).toBe('pm_desk');
    expect(stationFor('sprint_planning', 'project_manager')).toBe('meeting');
    expect(stationFor('blocked', 'software_engineer')).toBe('helpdesk');
    expect(stationFor('done', 'qa_engineer')).toBe('dock');
    expect(stationFor('lounge', null)).toBe('lounge');
  });

  it('finds shortest paths around furniture', () => {
    const path = findPath({ x: 2, y: 6 }, { x: 2, y: 11 })!;
    expect(path[0]).toEqual({ x: 2, y: 6 });
    expect(path.at(-1)).toEqual({ x: 2, y: 11 });
    for (const t of path) expect(walkable(t.x, t.y)).toBe(true);
    for (let i = 1; i < path.length; i++) expect(Math.abs(path[i]!.x - path[i - 1]!.x) + Math.abs(path[i]!.y - path[i - 1]!.y)).toBe(1);
    expect(findPath({ x: 2, y: 6 }, { x: 2, y: 5 })).toBeNull(); // into a desk
    expect(zoneTiles('lounge').length).toBeGreaterThan(5);
    expect(zoneTiles('nope')).toEqual([]);
    for (const o of OBJECTS) expect(o.label.length, o.id).toBeGreaterThan(2);
  });
});

describe('office simulation', () => {
  const CAST: CastRole[] = [
    { key: 'project_manager', name: 'Project Manager', color: '#6d4aff' },
    { key: 'software_engineer', name: 'Software Engineer', color: '#10b981' },
    { key: 'code_reviewer', name: 'Code Reviewer', color: '#f59e0b' },
    { key: 'qa_engineer', name: 'QA Engineer', color: '#ec4899' },
    { key: 'data_engineer', name: 'Data Engineer', color: '#0ea5e9' },
  ];
  const office = (seed = 1) => {
    const sim = new OfficeSim(seed);
    sim.setCast(CAST);
    return sim;
  };
  const role = (sim: OfficeSim, key: string) => sim.walkers.get(`role:${key}`)!;
  const at = (w: { x: number; y: number }) => ({ x: w.x, y: w.y });

  it('has one character per role, each already at their own desk', () => {
    const sim = office();
    expect([...sim.walkers.keys()]).toEqual(CAST.map((r) => `role:${r.key}`));
    expect(at(role(sim, 'software_engineer'))).toEqual(tileFeet(STATIONS.dev_desk[0]!));
    expect(at(role(sim, 'code_reviewer'))).toEqual(tileFeet(STATIONS.review[0]!));
    // A role added later gets a free hot desk.
    expect(role(sim, 'data_engineer').home).toEqual(HOT_DESKS[0]);
    const homes = [...sim.walkers.values()].map((w) => `${w.home!.x},${w.home!.y}`);
    expect(new Set(homes).size).toBe(homes.length);
    expect(role(sim, 'qa_engineer').look.accessory).toBe('goggles');
    expect(labelOf(role(sim, 'qa_engineer'))).toBe('QA Engineer');
  });

  it('lets an agent play a role: the character goes to work, then hands over to the next role', () => {
    const sim = office();
    sim.sync([agent({ stage: 'blocked', roleKey: 'software_engineer' })]);
    const engineer = role(sim, 'software_engineer');
    expect(engineer.driver).toMatchObject({ agentName: 'Claude Code', taskKey: 'SHOP-1' });
    expect(labelOf(engineer)).toBe('Software Engineer (Claude Code)');
    expect(engineer.station).toBe('helpdesk');
    expect(sim.drainCues().map((c) => c.cue)).toContain('poof');
    settle(sim, 20);
    expect(STATIONS.helpdesk.some((s) => tileFeet(s).x === engineer.x && tileFeet(s).y === engineer.y)).toBe(true);

    // The agent moves on to reviewing: the engineer goes home, the reviewer gets to work.
    sim.sync([agent({ stage: 'review', roleKey: 'code_reviewer' })]);
    expect(engineer.driver).toBeNull();
    expect(role(sim, 'code_reviewer').driver?.agentName).toBe('Claude Code');
    expect(role(sim, 'code_reviewer').working).toBe(true);
    expect(engineer.spot).toEqual(engineer.home); // heading back to their desk
    for (let t = 0; t < 20 * 15 && engineer.path.length > 0; t++) sim.update(0.05);
    expect(at(engineer)).toEqual(tileFeet(engineer.home!));
  });

  it('only gives a character to agents that are working', () => {
    const sim = office();
    sim.sync([agent({ working: false })]);
    expect(role(sim, 'software_engineer').driver).toBeNull();
  });

  it('brings in a colleague when two agents play the same role, and sees them out after', () => {
    const sim = office();
    sim.sync([agent(), agent({ id: 's2', name: 'Cursor', taskKey: 'SHOP-2' })]);
    const extra = sim.walkers.get('role:software_engineer#2')!;
    expect(extra.extra).toBe(true);
    expect(extra.driver?.agentName).toBe('Cursor');
    expect(extra.look).not.toEqual(role(sim, 'software_engineer').look);
    expect(extra.spot).not.toEqual(role(sim, 'software_engineer').spot);
    sim.sync([agent()]);
    expect(extra.leaving).toBe(true);
    settle(sim, 30);
    expect(sim.walkers.has('role:software_engineer#2')).toBe(false);
  });

  it('gives an unknown role a temporary character', () => {
    const sim = office();
    sim.sync([agent({ roleKey: 'brand_new', roleColor: '#123456' })]);
    const w = sim.walkers.get('role:brand_new')!;
    expect(w.extra).toBe(true);
    expect(w.look.shirt).toBe('#123456');
  });

  it('gathers the whole team in the meeting room during a ceremony', () => {
    const sim = office();
    sim.sync([agent({ stage: 'sprint_planning', roleKey: 'project_manager', taskKey: null })]);
    expect(sim.inMeeting).toBe(true);
    const seats = new Set(STATIONS.meeting.map((s) => `${s.x},${s.y}`));
    for (const w of sim.walkers.values()) expect(seats.has(`${w.spot!.x},${w.spot!.y}`), w.id).toBe(true);
    expect(new Set([...sim.walkers.values()].map((w) => `${w.spot!.x},${w.spot!.y}`)).size).toBe(CAST.length);
    sim.sync([]);
    for (const w of sim.walkers.values()) expect(w.spot, w.id).toEqual(w.home);
  });

  it('keeps idle characters busy with games, coffee and chats, and back to work when needed', () => {
    const sim = office(3);
    const seen = new Set<string>();
    const said = new Set<string>();
    for (let t = 0; t < 20 * 240; t++) {
      sim.update(0.05);
      for (const w of sim.walkers.values()) if (w.pastime) seen.add(w.pastime.kind);
      for (const b of sim.bubbles.values()) said.add(b.text);
    }
    expect(seen).toEqual(new Set(['console', 'coffee', 'arcade', 'chat']));
    // Conversations really happen, line by line.
    const lines = CONVERSATIONS.flat();
    expect([...said].filter((t) => lines.includes(t)).length).toBeGreaterThan(2);
    // Pastimes stop as soon as an agent needs the role.
    const someone = [...sim.walkers.values()].find((w) => w.roleKey === 'qa_engineer')!;
    sim.sync([agent({ stage: 'testing', roleKey: 'qa_engineer' })]);
    expect(someone.pastime).toBeNull();
    expect(someone.station).toBe('qa');
  });

  it('runs a conversation in turns and lets everyone go back afterwards', () => {
    const sim = office(1);
    for (let t = 0; t < 20 * 600 && sim.chats.length === 0; t++) sim.update(0.05);
    const chat = sim.chats[0]!;
    expect(chat.members.length).toBeGreaterThanOrEqual(2);
    const said: Array<[string, string]> = [];
    for (let t = 0; t < 20 * 90 && sim.chats.includes(chat); t++) {
      sim.update(0.05);
      for (const id of chat.members) {
        const text = sim.bubbles.get(id)?.text;
        if (text && chat.script.includes(text) && !said.some(([, s]) => s === text)) said.push([id, text]);
      }
    }
    // Every line was said, in order, by the members taking turns.
    expect(said.map(([, text]) => text)).toEqual([...chat.script]);
    expect(said.map(([id]) => id)).toEqual(chat.script.map((_, i) => chat.members[i % chat.members.length]));
    // Afterwards everyone is free again.
    expect(sim.chats.includes(chat)).toBe(false);
    for (const id of chat.members) expect(sim.walkers.get(id)!.pastime?.chat).not.toBe(chat.id);
  });

  it('answers in character when poked, and gets annoyed when poked too often', () => {
    const sim = office();
    expect(sim.poke('role:qa_engineer')).toBe("QA Engineer: I'm the QA Engineer. No bugs to hunt right now.");
    expect(sim.poke('role:qa_engineer')).toBe('QA Engineer: Sharpening my bug net.');
    sim.sync([agent()]);
    sim.drainCues();
    expect(sim.poke('role:software_engineer')).toBe("Software Engineer: I'm the Software Engineer. Claude Code has me on SHOP-1.");
    sim.poke('role:software_engineer');
    sim.poke('role:software_engineer');
    expect(role(sim, 'software_engineer').emote?.kind).toBe('sweat');
    expect(sim.poke('role:software_engineer')).toBe('Software Engineer: Hey! Stop poking me!');
    expect(role(sim, 'software_engineer').emote?.kind).toBe('anger');
    expect(sim.drainCues().map((c) => c.cue)).toContain('annoyed');
    sim.update(10);
    expect(sim.poke('role:software_engineer')).toContain("I'm the Software Engineer");
  });

  it('says pastime lines when someone is playing or on a coffee break', () => {
    const sim = office(3);
    let gamer: string | null = null;
    for (let t = 0; t < 20 * 600 && !gamer; t++) {
      sim.update(0.05);
      gamer = [...sim.walkers.values()].find((w) => w.pastime?.kind === 'console')?.id ?? null;
    }
    expect(['Shh, boss level!']).toContain(sim.poke(gamer!)!.split(': ')[1]);
  });

  it('lets the character of the role speak, and brings people to the help desk', () => {
    const sim = office();
    sim.sync([agent()]);
    expect(sim.say({ name: 'Claude Code', kind: 'agent', roleKey: 'software_engineer' }, 'Writing the tests')).toBe('role:software_engineer');
    // A line said in another role comes from that role's character, even if nobody plays it now.
    expect(sim.say({ name: 'Claude Code', kind: 'agent', roleKey: 'code_reviewer' }, 'Approved')).toBe('role:code_reviewer');
    // Without a role, the character the agent is playing speaks.
    expect(sim.say({ name: 'Claude Code', kind: 'agent', roleKey: null }, 'Hmm')).toBe('role:software_engineer');
    expect(sim.say({ name: 'Nobody', kind: 'agent', roleKey: null }, 'hello')).toBeNull();
    // A question from a role nobody is playing: that character waits at the help desk.
    sim.say({ name: 'Cursor', kind: 'agent', roleKey: 'qa_engineer' }, 'Which browsers?', 'question');
    expect(role(sim, 'qa_engineer').pastime?.kind).toBe('help');
    expect(role(sim, 'qa_engineer').emote?.kind).toBe('question');
    expect(sim.poke('role:qa_engineer')).toBe('QA Engineer: I asked you something! Check Needs Human.');
    sim.say({ name: 'Claude Code', kind: 'agent', roleKey: 'software_engineer' }, 'Which country?', 'question');
    expect(role(sim, 'software_engineer').emote?.kind).toBe('question');

    const id = sim.say({ name: 'Ada', kind: 'user' }, 'Philippines only', 'answer')!;
    expect(id).toBe('human:Ada');
    settle(sim, 10);
    expect(at(sim.walkers.get(id)!)).toEqual(tileFeet({ x: 27, y: 3 }));
    settle(sim, 30);
    expect(sim.walkers.has(id)).toBe(false);
    expect(bubbleSeconds('x'.repeat(500))).toBe(10);
    expect(bubbleSeconds('hi', 'fast')).toBeLessThan(bubbleSeconds('hi', 'slow'));
  });

  it('walks at a steady pace', () => {
    const sim = office();
    sim.sync([agent({ stage: 'done' })]);
    const w = role(sim, 'software_engineer');
    const start = at(w);
    sim.update(0.5);
    expect(Math.abs(w.x - start.x) + Math.abs(w.y - start.y)).toBeCloseTo(WALK_SPEED * 0.5, 0);
  });

  it('makes objects react, using the board numbers where it matters', () => {
    const sim = office();
    sim.stats = { blocked: 2, done: 1, todo: 3 };
    expect(sim.poke('bell')).toBe('2 items need your answer!');
    expect(sim.poke('gong')).toBe('1 item shipped! BONG!');
    expect(sim.poke('kanban')).toContain('To Do 3');
    expect(sim.poke('duck')).toBe('Squeak!');
    expect(sim.poke('tv')).toBe('Press START.');
    expect(sim.poke('arcade')).toBe('INSERT COIN');
    expect(sim.objects.get('duck')!.until).toBeGreaterThan(sim.now);
    for (let i = 0; i < 3; i++) sim.poke('printer');
    expect(sim.poke('printer')).toContain('Fixed it');
    expect(sim.drainCues().map((c) => c.cue)).toEqual(expect.arrayContaining(['ding', 'gong', 'squeak', 'jam', 'paper', 'beep']));
    expect(sim.poke('nothing-here')).toBeNull();
    sim.stats = {};
    expect(sim.poke('bell')).toBe('Nothing needs you right now.');
  });

  it('has a cat that wanders, naps, and hisses when bothered', () => {
    const sim = office(3);
    settle(sim, 60);
    expect(walkable(Math.floor(sim.cat.x / TILE), Math.floor((sim.cat.y - 1) / TILE))).toBe(true);
    sim.poke('cat');
    sim.poke('cat');
    expect(sim.poke('cat')).toBe('Cat: Hiss!');
    expect(sim.cat.emote?.kind).toBe('anger');
  });

  it('finds what was clicked and lists everything for keyboard play', () => {
    const sim = office();
    const w = role(sim, 'code_reviewer');
    expect(sim.hitTest(w.x, w.y - 10)).toBe('role:code_reviewer');
    expect(sim.hitTest(14 * TILE + 8, 14 * TILE + 8)).toBe('duck');
    expect(sim.hitTest(5, 5)).toBeNull();
    const targets = sim.targets();
    expect(targets.map((t) => t.id)).toEqual(expect.arrayContaining(['role:code_reviewer', 'cat', 'duck', 'kanban', 'tv']));
    expect(targets.find((t) => t.id === 'role:code_reviewer')!.label).toBe('Code Reviewer');
    const rows = targets.map((t) => Math.floor(t.y / TILE));
    expect([...rows].sort((a, b) => a - b)).toEqual(rows);
  });

  it('is repeatable with the same seed', () => {
    const a = rng(42);
    const b = rng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('music', () => {
  it('has loops of exactly eight bars with valid notes', () => {
    for (const track of TRACKS) {
      for (const voice of ['lead', 'bass', 'drums'] as const) expect(tokens(track[voice]), `${track.id} ${voice}`).toHaveLength(STEPS);
      expect(track.chords).toHaveLength(8);
      const compiled = compileTrack(track);
      for (const n of [...compiled.leadNotes, ...compiled.bassNotes]) {
        expect(n.midi).toBeGreaterThanOrEqual(36);
        expect(n.midi).toBeLessThanOrEqual(96);
        expect(n.step + n.length).toBeLessThanOrEqual(STEPS);
      }
      expect(compiled.drumHits.length).toBeGreaterThan(30);
      expect(compiled.stepSeconds).toBeCloseTo(60 / track.bpm / 2);
    }
  });

  it('reads notes, holds, rests, drums and chords', () => {
    expect(noteToMidi('C4')).toBe(60);
    expect(noteToMidi('A4')).toBe(69);
    expect(noteToMidi('F#5')).toBe(78);
    expect(noteToMidi('Bb3')).toBe(58);
    expect(noteToMidi('H2')).toBeNull();
    expect(parseVoice('C4 - - . E4 | G4')).toEqual([
      { step: 0, midi: 60, length: 3 },
      { step: 4, midi: 64, length: 1 },
      { step: 5, midi: 67, length: 1 },
    ]);
    expect(() => parseVoice('C4 Z9')).toThrow(/Unknown note/);
    expect(parseDrums('k . x')).toEqual([
      { step: 0, hits: ['kick'] },
      { step: 2, hits: ['kick', 'hat'] },
    ]);
    expect(chordNotes('Am')).toEqual([69, 72, 76, 81]);
    expect(chordNotes('C')).toEqual([60, 64, 67, 72]);
  });
});

describe('settings', () => {
  it('validates stored settings and falls back to defaults', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ music: 'yes', musicVolume: 5, track: 'nope', sfxVolume: -1, textSpeed: 'warp', names: false })).toEqual({
      ...DEFAULT_SETTINGS,
      musicVolume: 1,
      sfxVolume: 0,
      names: false,
    });
    expect(parseSettings({ music: true, track: 'release', textSpeed: 'fast', musicVolume: 0.33 })).toMatchObject({ music: true, track: 'release', textSpeed: 'fast', musicVolume: 0.3 });
    expect(DEFAULT_SETTINGS.music).toBe(false); // never surprise anyone with music
  });
});

describe('office chatter', () => {
  const activity = (over: Partial<ActivityDTO>): ActivityDTO => ({
    id: 'a1',
    projectId: 'p',
    taskId: 't',
    taskKey: 'SHOP-1',
    actorType: 'agent',
    actorUserId: 'u',
    actorName: 'Claude Code',
    roleKey: 'software_engineer',
    action: 'task.moved',
    message: '',
    fromKind: null,
    toKind: null,
    ceremony: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  });
  const stage = (k: string) => ({ review: 'Code Review', testing: 'QA / Testing' })[k] ?? k;

  it('turns markdown into a short spoken sentence', () => {
    expect(speech('**Done:** added `cart` [docs](https://x.y)\n\n```ts\nconst a = 1;\n```\n- tests pass')).toBe('Done: added cart docs (code) tests pass');
    const long = speech('word '.repeat(80), 40);
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long.endsWith('…')).toBe(true);
  });

  it('stays fast on hostile remarks', () => {
    for (const hostile of ['['.repeat(50_000), '\n'.repeat(50_000), '- '.repeat(25_000), '`'.repeat(50_000)]) {
      const started = performance.now();
      speech(hostile);
      expect(performance.now() - started).toBeLessThan(50);
    }
  });

  it('says what happened on the board', () => {
    expect(lineFromActivity(activity({ fromKind: 'in_progress', toKind: 'review' }), stage)!.text).toBe('SHOP-1 → Code Review.');
    expect(lineFromActivity(activity({ fromKind: 'testing', toKind: 'done' }), stage)).toMatchObject({ text: 'SHOP-1 is done!', cue: 'jingle' });
    expect(lineFromActivity(activity({ fromKind: 'review', toKind: 'in_progress' }), stage)!.text).toContain('needs changes');
    expect(lineFromActivity(activity({ fromKind: 'in_progress', toKind: 'blocked' }), stage)).toMatchObject({ tone: 'question', cue: 'chime' });
    expect(lineFromActivity(activity({ action: 'ceremony.started', ceremony: 'sprint_planning' }), stage)).toMatchObject({ cue: 'fanfare' });
    expect(lineFromActivity(activity({ action: 'agent.progress', message: 'Running **tests**' }), stage)!.text).toBe('Running tests');
    expect(lineFromActivity(activity({ action: 'remark.created' }), stage)).toBeNull();
    expect(lineFromActivity(activity({ fromKind: 'backlog', toKind: 'todo' }), stage)).toBeNull();
  });

  it('reads remarks: agents their notes, people their answers', () => {
    const remark = (over: Partial<RemarkDTO>): RemarkDTO => ({
      id: 'r1',
      taskId: 't',
      projectId: 'p',
      authorType: 'agent',
      authorUserId: null,
      authorName: 'Cursor',
      roleKey: 'qa_engineer',
      kind: 'test_report',
      body: 'All **12** tests pass',
      createdAt: '2026-01-01T00:00:00Z',
      ...over,
    });
    expect(lineFromRemark(remark({}))).toMatchObject({ speaker: { kind: 'agent', name: 'Cursor' }, text: 'All 12 tests pass', tone: 'say' });
    expect(lineFromRemark(remark({ kind: 'question' }))).toMatchObject({ tone: 'question', cue: 'chime' });
    expect(lineFromRemark(remark({ authorType: 'user', authorName: 'Ada', kind: 'answer', body: 'Yes' }))).toMatchObject({ speaker: { kind: 'user' }, tone: 'answer' });
    expect(lineFromRemark(remark({ kind: 'system' }))).toBeNull();
  });
});

describe('office renderer', () => {
  it('draws a whole frame with people, the cat, bubbles and the keyboard pointer', () => {
    const sim = new OfficeSim(1);
    sim.stats = { todo: 2, done: 3, blocked: 1, in_progress: 1 };
    sim.setCast([
      { key: 'project_manager', name: 'Project Manager', color: '#6d4aff' },
      { key: 'software_engineer', name: 'Software Engineer', color: '#10b981' },
    ]);
    sim.sync([agent(), agent({ id: 's2', name: 'Cursor', stage: 'sprint_planning', roleKey: 'project_manager' })]);
    settle(sim, 5);
    sim.say({ name: 'Claude Code', kind: 'agent', roleKey: 'software_engineer' }, 'A rather long sentence that has to wrap over several lines inside the speech bubble to fit');
    sim.say({ name: 'Ada', kind: 'user' }, 'Sounds good');
    sim.poke('coffee');
    sim.update(1);
    const { painter, rects, texts } = fakePainter(2);
    renderOffice(painter, sim, { names: true, focusId: 'duck', hoverId: 's1', textSpeed: 'instant' });
    expect(rects.length).toBeGreaterThan(1000);
    expect(texts).toEqual(expect.arrayContaining(['Software Engineer', 'Project Manager', 'Claude Code', 'Cursor', 'Ada (you)', 'LOOP CODER HQ', 'BACKLOG']));
    expect(texts.some((t) => t.startsWith('A rather long'))).toBe(true);
  });
});
