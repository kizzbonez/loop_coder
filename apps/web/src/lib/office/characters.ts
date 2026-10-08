// Pixel characters for the agent office, drawn in code (16 × 24 world pixels, feet at the anchor).
// Who someone is (skin, hair) comes from their name; what they wear and carry comes from the role
// they are playing. Built-in roles have hand-picked outfits; any other role, including roles
// added later, gets a stable outfit derived from its key and coloured with the role's colour.
import { hash, PALETTE, pick, px, safeColor, shade, type Painter } from './pixels';

export type Dir = 'down' | 'up' | 'left' | 'right';
export type Outfit = 'shirt' | 'hoodie' | 'coat' | 'suit';
export type HairStyle = 'short' | 'spiky' | 'long' | 'bun' | 'curly' | 'bald' | 'mohawk';
export type Accessory = 'none' | 'glasses' | 'goggles' | 'hardhat' | 'beret' | 'headset' | 'cap' | 'scarf' | 'bow' | 'bandana';
export type Prop = 'none' | 'clipboard' | 'laptop' | 'blueprint' | 'palette' | 'magnifier' | 'bugnet' | 'wrench' | 'shield' | 'quill' | 'mug' | 'book' | 'wateringcan';

export interface Look {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  outfit: Outfit;
  shirt: string;
  pants: string;
  shoes: string;
  accessory: Accessory;
  accessoryColor: string;
  prop: Prop;
}

const SKINS = ['#f6d2b5', '#eab896', '#c98e66', '#a0694a', '#7a4b35', '#f3c6a5'] as const;
const HAIRS = ['#2b2135', '#5a3a29', '#a5683a', '#e3b85a', '#c44d3c', '#7f8796', '#3d6fb6', '#d36aa6', '#efe9dc'] as const;
const STYLES: readonly HairStyle[] = ['short', 'spiky', 'long', 'bun', 'curly', 'bald', 'mohawk'];
const PANTS = ['#2f3a56', '#3d3d48', '#4a3b2f', '#25466b', '#3b4f3a'] as const;
const SHOES = ['#2a2230', '#5b3b2a', '#f4f1e8', '#7a2e3a'] as const;
const CASUAL = ['#e07a5f', '#3d9970', '#5c7cfa', '#f2a541', '#9b5de5', '#2ec4b6'] as const;

/** Outfits for the built-in roles. */
export const ROLE_LOOKS: Readonly<Record<string, Pick<Look, 'outfit' | 'accessory' | 'prop'>>> = {
  project_manager: { outfit: 'suit', accessory: 'none', prop: 'clipboard' },
  architect: { outfit: 'shirt', accessory: 'hardhat', prop: 'blueprint' },
  ui_designer: { outfit: 'shirt', accessory: 'beret', prop: 'palette' },
  senior_developer: { outfit: 'hoodie', accessory: 'glasses', prop: 'mug' },
  backend_developer: { outfit: 'hoodie', accessory: 'bandana', prop: 'laptop' },
  frontend_developer: { outfit: 'shirt', accessory: 'bow', prop: 'laptop' },
  code_reviewer: { outfit: 'shirt', accessory: 'glasses', prop: 'magnifier' },
  qa_engineer: { outfit: 'coat', accessory: 'goggles', prop: 'bugnet' },
  devops_engineer: { outfit: 'shirt', accessory: 'headset', prop: 'wrench' },
  security_engineer: { outfit: 'suit', accessory: 'cap', prop: 'shield' },
  tech_writer: { outfit: 'shirt', accessory: 'scarf', prop: 'quill' },
};

const CUSTOM_OUTFITS: readonly Outfit[] = ['shirt', 'hoodie', 'coat', 'suit'];
const CUSTOM_ACCESSORIES: readonly Accessory[] = ['glasses', 'cap', 'beret', 'headset', 'scarf', 'bow', 'bandana', 'goggles'];
const CUSTOM_PROPS: readonly Prop[] = ['book', 'laptop', 'clipboard', 'wrench', 'palette', 'magnifier', 'shield', 'quill'];

/** The outfit for a role: hand-picked for built-in roles, generated from the key for others. */
export function roleOutfit(roleKey: string): Pick<Look, 'outfit' | 'accessory' | 'prop'> {
  const known = ROLE_LOOKS[roleKey];
  if (known) return known;
  const h = hash(`role:${roleKey}`);
  return { outfit: pick(CUSTOM_OUTFITS, h), accessory: pick(CUSTOM_ACCESSORIES, h >>> 4), prop: pick(CUSTOM_PROPS, h >>> 9) };
}

/** How someone looks: identity from their name, clothes from their role (casual without one). */
export function lookFor(name: string, role?: { key: string; color?: string | null } | null): Look {
  const h = hash(`who:${name}`);
  const identity = {
    skin: pick(SKINS, h),
    hair: pick(HAIRS, h >>> 3),
    hairStyle: pick(STYLES, h >>> 7),
    pants: pick(PANTS, h >>> 11),
    shoes: pick(SHOES, h >>> 14),
  };
  if (!role) {
    return { ...identity, outfit: 'shirt', shirt: pick(CASUAL, h >>> 17), accessory: 'none', accessoryColor: PALETTE.red, prop: 'mug' };
  }
  const color = safeColor(role.color, pick(CASUAL, hash(role.key)));
  return { ...identity, ...roleOutfit(role.key), shirt: color, accessoryColor: shade(color, -0.25) };
}

/**
 * The character of a role in the office: the same person every time, dressed for the role.
 * `instance` > 1 is a colleague in the same role (when several agents play it at once).
 */
export function roleCharacter(role: { key: string; color?: string | null }, instance = 1): Look {
  return lookFor(instance > 1 ? `role:${role.key}#${instance}` : `role:${role.key}`, role);
}

export interface CharacterPose {
  dir: Dir;
  /** Walk cycle 0–3 (0 and 2 are standing). */
  frame: number;
  /** Typing at a desk (arms move). */
  working?: boolean;
  /** Horizontal shake in world pixels (annoyed). */
  shake?: number;
  /** Frown instead of a neutral mouth. */
  grumpy?: boolean;
  /** Hop height in world pixels. */
  hop?: number;
}

/** Draw a character with its feet at (footX, footY). */
export function drawCharacter(p: Painter, look: Look, footX: number, footY: number, pose: CharacterPose): void {
  const side = pose.dir === 'left' || pose.dir === 'right';
  const flip = pose.dir === 'right';
  const ox = Math.round(footX - 8 + (pose.shake ?? 0));
  const oy = Math.round(footY - 24 - (pose.hop ?? 0));
  // Local 16 × 24 grid; side views are drawn facing left and mirrored for "right".
  const L = (x: number, y: number, w: number, h: number, c: string) => px(p, ox + (flip ? 16 - x - w : x), oy + y, w, h, c);

  const { skin, shirt } = look;
  const skinDark = shade(skin, -0.18);
  const shirtDark = shade(shirt, -0.25);
  const shirtLight = shade(shirt, 0.25);
  const ink = PALETTE.outline;
  const step = pose.frame % 4;
  const typing = pose.working ? Math.floor(p.time * 7) % 2 : 0;

  // Shadow
  px(p, footX - 5, footY - 1, 10, 2, PALETTE.shadow);

  // Legs and shoes (lift one foot while walking)
  const lift = (leg: 0 | 1) => ((step === 1 && leg === 0) || (step === 3 && leg === 1) ? 1 : 0);
  if (side) {
    const fwd = step === 1 ? -1 : step === 3 ? 1 : 0;
    L(6 + fwd, 18, 3, 4, look.pants);
    L(6 - fwd, 18, 3, 4, shade(look.pants, -0.15));
    L(5 + fwd, 22, 4, 1, look.shoes);
    L(5 - fwd, 22, 4, 1, shade(look.shoes, -0.2));
  } else {
    L(5, 18, 6, 2, look.pants);
    L(5, 20 - lift(0), 3, 2, look.pants);
    L(8, 20 - lift(1), 3, 2, look.pants);
    L(5, 22 - lift(0), 3, 1, look.shoes);
    L(8, 22 - lift(1), 3, 1, look.shoes);
  }

  // Hood behind the head
  if (look.outfit === 'hoodie' && pose.dir !== 'up') L(side ? 6 : 4, 9, side ? 7 : 8, 3, shirtDark);

  // Body
  const bodyX = side ? 5 : 4;
  const bodyW = side ? 7 : 8;
  if (look.outfit === 'coat') {
    L(bodyX - 1, 10, bodyW + 2, 10, ink);
    L(bodyX, 11, bodyW, 9, PALETTE.white);
    if (!side && pose.dir === 'down') L(7, 11, 2, 6, shirt);
    L(bodyX, 11, 1, 9, shade(PALETTE.white, -0.12));
  } else {
    const jacket = look.outfit === 'suit' ? shade(shirt, -0.45) : shirt;
    L(bodyX - 1, 10, bodyW + 2, 9, ink);
    L(bodyX, 11, bodyW, 7, jacket);
    L(bodyX, 11, 1, 7, shade(jacket, -0.2));
    if (pose.dir === 'down') {
      if (look.outfit === 'suit') {
        L(7, 11, 2, 3, PALETTE.white);
        L(7, 12, 2, 4, shirt);
      } else if (look.outfit === 'hoodie') {
        L(7, 12, 1, 2, PALETTE.white);
        L(8, 12, 1, 2, PALETTE.white);
        L(5, 15, 6, 2, shirtDark);
      } else {
        L(6, 11, 4, 1, shirtLight);
      }
    }
  }

  // Arms (swing while walking, tap while typing)
  const swing = step === 1 ? 1 : step === 3 ? -1 : 0;
  const sleeve = look.outfit === 'coat' ? PALETTE.white : look.outfit === 'suit' ? shade(shirt, -0.5) : shirtDark;
  if (side) {
    L(8 + swing, 12, 2, 5, sleeve);
    L(8 + swing, 17, 2, 1, skin);
  } else if (pose.working && pose.dir === 'up') {
    L(3, 11 - typing, 1, 4, sleeve);
    L(12, 10 + typing, 1, 4, sleeve);
    L(3, 10 - typing, 1, 1, skin);
    L(12, 9 + typing, 1, 1, skin);
  } else {
    L(3, 12 + swing, 1, 5, sleeve);
    L(12, 12 - swing, 1, 5, sleeve);
    L(3, 17 + swing, 1, 1, skin);
    L(12, 17 - swing, 1, 1, skin);
  }

  // Head
  L(side ? 4 : 3, 1, side ? 9 : 10, 10, ink);
  L(side ? 5 : 4, 2, side ? 7 : 8, 8, skin);
  L(7, 10, 2, 1, skinDark);
  if (pose.dir === 'down') {
    L(6, 6, 1, 2, ink);
    L(9, 6, 1, 2, ink);
    if (pose.grumpy) {
      L(5, 5, 2, 1, ink);
      L(9, 5, 2, 1, ink);
      L(7, 9, 2, 1, ink);
      L(6, 8, 1, 1, ink);
      L(9, 8, 1, 1, ink);
    } else {
      L(7, 8, 2, 1, shade(skin, -0.35));
    }
    L(5, 7, 1, 1, shade(skin, 0.1));
  } else if (side) {
    L(5, 6, 1, 2, ink);
    L(5, 8, 2, 1, pose.grumpy ? ink : shade(skin, -0.35));
  }

  drawHair(L, look, pose.dir);
  drawAccessory(L, look, pose.dir);
  if (pose.dir !== 'up') drawProp(L, look, side);
}

type Local = (x: number, y: number, w: number, h: number, c: string) => void;

function drawHair(L: Local, look: Look, dir: Dir): void {
  const { hair, hairStyle } = look;
  const dark = shade(hair, -0.2);
  if (hairStyle === 'bald') {
    L(6, 2, 2, 1, shade(look.skin, 0.25));
    return;
  }
  if (dir === 'up') {
    L(4, 2, 8, 7, hair);
    L(4, 8, 8, 1, dark);
    if (hairStyle === 'long') L(4, 9, 8, 2, hair);
    if (hairStyle === 'bun') L(6, 0, 4, 2, hair);
    if (hairStyle === 'mohawk') L(7, 0, 2, 2, hair);
    return;
  }
  const side = dir === 'left' || dir === 'right';
  if (side) {
    L(5, 1, 7, 3, hair);
    L(9, 3, 3, 5, hair);
    if (hairStyle === 'long') L(9, 3, 4, 8, hair);
    if (hairStyle === 'bun') L(10, 0, 3, 3, hair);
    if (hairStyle === 'spiky') {
      L(6, 0, 1, 1, hair);
      L(9, 0, 1, 1, hair);
    }
    if (hairStyle === 'mohawk') L(7, -1, 3, 2, hair);
    return;
  }
  L(4, 1, 8, 3, hair);
  L(4, 4, 1, 2, hair);
  L(11, 4, 1, 2, hair);
  L(5, 3, 6, 1, dark);
  switch (hairStyle) {
    case 'spiky':
      L(5, 0, 1, 1, hair);
      L(8, 0, 1, 1, hair);
      L(10, 0, 1, 1, hair);
      break;
    case 'long':
      L(3, 3, 1, 8, hair);
      L(12, 3, 1, 8, hair);
      break;
    case 'bun':
      L(6, -1, 4, 2, hair);
      break;
    case 'curly':
      L(3, 1, 1, 4, hair);
      L(12, 1, 1, 4, hair);
      L(5, 0, 2, 1, hair);
      L(9, 0, 2, 1, hair);
      break;
    case 'mohawk':
      L(7, -1, 2, 2, hair);
      break;
  }
}

function drawAccessory(L: Local, look: Look, dir: Dir): void {
  const c = look.accessoryColor;
  const front = dir === 'down';
  const side = dir === 'left' || dir === 'right';
  switch (look.accessory) {
    case 'glasses':
      if (front) {
        L(5, 6, 2, 2, PALETTE.outline);
        L(9, 6, 2, 2, PALETTE.outline);
        L(7, 6, 2, 1, PALETTE.outline);
        L(5, 6, 1, 1, PALETTE.windowShine);
        L(9, 6, 1, 1, PALETTE.windowShine);
      } else if (side) {
        L(4, 6, 3, 2, PALETTE.outline);
        L(7, 6, 3, 1, PALETTE.outline);
      }
      break;
    case 'goggles':
      L(4, 5, 8, 1, c);
      if (front) {
        L(5, 5, 3, 3, PALETTE.cyan);
        L(8, 5, 3, 3, PALETTE.cyan);
        L(5, 5, 1, 1, PALETTE.windowShine);
      } else if (side) {
        L(4, 5, 3, 3, PALETTE.cyan);
      }
      break;
    case 'hardhat':
      L(3, 0, 10, 3, PALETTE.yellow);
      L(2, 3, 12, 1, shade(PALETTE.yellow, -0.3));
      L(7, 0, 2, 3, shade(PALETTE.yellow, 0.3));
      break;
    case 'beret':
      L(4, 0, 9, 2, c);
      L(3, 1, 2, 1, c);
      L(8, -1, 1, 1, c);
      break;
    case 'headset':
      L(4, 0, 8, 1, PALETTE.outline);
      if (!side || dir === 'left') L(3, 4, 1, 3, PALETTE.outline);
      if (!side) L(12, 4, 1, 3, PALETTE.outline);
      if (front) L(10, 8, 3, 1, PALETTE.outline);
      if (side) L(4, 8, 2, 1, PALETTE.outline);
      break;
    case 'cap':
      L(4, 0, 8, 3, c);
      if (front) L(4, 3, 9, 1, shade(c, -0.3));
      if (side) L(1, 3, 6, 1, shade(c, -0.3));
      if (dir === 'up') L(5, 3, 6, 1, shade(c, -0.3));
      break;
    case 'scarf':
      L(4, 10, 8, 2, c);
      if (front) L(9, 12, 2, 3, c);
      break;
    case 'bow':
      L(10, 0, 3, 2, PALETTE.pink);
      L(11, 0, 1, 2, shade(PALETTE.pink, -0.3));
      break;
    case 'bandana':
      L(4, 2, 8, 1, c);
      if (!front) L(11, 2, 2, 3, c);
      break;
    case 'none':
      break;
  }
}

function drawProp(L: Local, look: Look, side: boolean): void {
  const x = side ? 2 : 12;
  const c = look.accessoryColor;
  switch (look.prop) {
    case 'clipboard':
      L(x, 13, 4, 5, PALETTE.wood);
      L(x + 1, 14, 2, 3, PALETTE.paper);
      L(x + 1, 12, 2, 1, PALETTE.metal);
      break;
    case 'laptop':
      L(x - 1, 15, 5, 3, PALETTE.metalDark);
      L(x, 15, 3, 2, PALETTE.cyan);
      break;
    case 'blueprint':
      L(x, 12, 3, 7, PALETTE.blue);
      L(x + 1, 13, 1, 5, shade(PALETTE.blue, 0.4));
      break;
    case 'palette':
      L(x, 14, 4, 3, PALETTE.woodLight);
      L(x, 14, 1, 1, PALETTE.red);
      L(x + 2, 14, 1, 1, PALETTE.blue);
      L(x + 1, 15, 1, 1, PALETTE.yellow);
      L(x + 3, 15, 1, 1, PALETTE.green);
      break;
    case 'magnifier':
      L(x, 11, 3, 3, PALETTE.metal);
      L(x + 1, 12, 1, 1, PALETTE.windowShine);
      L(x + 2, 14, 1, 3, PALETTE.woodDark);
      break;
    case 'bugnet':
      L(x + 1, 10, 1, 9, PALETTE.wood);
      L(x, 6, 3, 4, shade(PALETTE.white, -0.1));
      L(x, 6, 3, 1, PALETTE.metal);
      break;
    case 'wrench':
      L(x + 1, 13, 1, 6, PALETTE.metal);
      L(x, 12, 3, 2, PALETTE.metal);
      L(x + 1, 12, 1, 1, PALETTE.metalDark);
      break;
    case 'shield':
      L(x, 13, 4, 5, PALETTE.metalDark);
      L(x + 1, 14, 2, 3, c);
      L(x + 1, 18, 2, 1, PALETTE.metalDark);
      break;
    case 'quill':
      L(x + 1, 10, 1, 7, PALETTE.white);
      L(x + 2, 11, 1, 4, shade(PALETTE.white, -0.15));
      L(x + 1, 17, 1, 1, PALETTE.outline);
      break;
    case 'mug':
      L(x, 15, 3, 3, PALETTE.white);
      L(x + 3, 16, 1, 1, PALETTE.white);
      L(x, 15, 3, 1, PALETTE.woodDark);
      break;
    case 'book':
      L(x, 14, 4, 5, c);
      L(x, 15, 1, 3, PALETTE.paper);
      break;
    case 'wateringcan':
      L(x - 1, 14, 4, 4, PALETTE.green);
      L(x - 1, 14, 4, 1, shade(PALETTE.green, 0.3));
      L(x + 3, 13, 2, 1, PALETTE.green);
      L(x + 4, 12, 1, 1, PALETTE.green);
      L(x, 12, 2, 2, shade(PALETTE.green, -0.3));
      break;
    case 'none':
      break;
  }
}

/** The office cat: 12 × 9 world pixels, feet at the anchor. */
export function drawCat(p: Painter, footX: number, footY: number, dir: 'left' | 'right', frame: number, sleeping: boolean): void {
  const flip = dir === 'right';
  const ox = Math.round(footX - 6);
  const oy = Math.round(footY - 9);
  const L = (x: number, y: number, w: number, h: number, c: string) => px(p, ox + (flip ? 12 - x - w : x), oy + y, w, h, c);
  const fur = '#f0a35e';
  const dark = '#c4743a';
  px(p, footX - 5, footY - 1, 10, 2, PALETTE.shadow);
  if (sleeping) {
    L(1, 4, 10, 5, fur);
    L(2, 4, 3, 1, dark);
    L(7, 5, 3, 1, dark);
    L(0, 6, 2, 2, fur);
    L(1, 3, 2, 1, fur);
    L(3, 3, 1, 1, fur);
    return;
  }
  const legShift = frame % 2;
  L(3, 3, 7, 4, fur);
  L(5, 3, 1, 4, dark);
  L(7, 3, 1, 4, dark);
  L(0, 1, 4, 4, fur);
  L(0, 0, 1, 1, fur);
  L(3, 0, 1, 1, fur);
  L(1, 2, 1, 1, PALETTE.outline);
  L(10, 1 + legShift, 1, 3, fur);
  L(11, 0 + legShift, 1, 2, fur);
  L(3, 7, 1, 2 - legShift, dark);
  L(5, 7, 1, 1 + legShift, dark);
  L(8, 7, 1, 2 - legShift, dark);
}
