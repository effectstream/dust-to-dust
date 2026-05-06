#!/usr/bin/env node
/**
 * Achievement Icon Generator
 *
 * Generates 64x64 pixel-art achievement icons by compositing
 * existing game assets (backgrounds, spirits, orbs, icons).
 *
 * Usage:
 *   npm install sharp   (if not already installed)
 *   node generate-achievements.js
 *
 * Output: public/achievements/*.png
 */

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const PUB = path.join(__dirname, 'public');
const OUT = path.join(PUB, 'achievements');
const SIZE = 64;

// ─── Sprite content bounding boxes (pre-measured) ───────────────────────────
// These exclude transparent padding so sprites scale to fill the icon.

const SPIRIT_BOUNDS = {
  fire: { left: 21, top: 21, width: 24, height: 23 },
  ice:  { left: 25, top: 17, width: 20, height: 27 },
  phys: { left: 23, top: 17, width: 25, height: 27 },
  def:  { left: 24, top: 21, width: 17, height: 24 },
};
const SPIRIT_FILES = {
  fire: 'spirit-atk-fire.png', ice: 'spirit-atk-ice.png',
  phys: 'spirit-atk-phys.png', def: 'spirit-def.png',
};

const ORB_BOUNDS = {
  fire: { left: 4, top: 1, width: 4, height: 8 },
  ice:  { left: 4, top: 1, width: 4, height: 9 },
  phys: { left: 2, top: 1, width: 9, height: 9 },
  def:  { left: 2, top: 2, width: 8, height: 9 },
};
const ORB_FILES = {
  fire: 'orb-atk-fire.png', ice: 'orb-atk-ice.png',
  phys: 'orb-atk-phys.png', def: 'orb-def.png',
};

const BOSS_FRAMES = {
  dragon:     { file: 'enemy-boss-dragon-1.png',    w: 145, h: 97 },
  sphinx:     { file: 'enemy-boss-sphinx.png',      w: 80,  h: 94 },
  abominable: { file: 'enemy-boss-abominable.png',  w: 130, h: 98 },
  enigma:     { file: 'enemy-boss-enigma-1.png',    w: 152, h: 95 },
};

// ─── Helper functions ───────────────────────────────────────────────────────

/** Crop background to 64x64 using cover-fit, apply brightness + optional tint */
async function cropBg(bgFile, { tintR = 0, tintG = 0, tintB = 0, brightness = 0.35 } = {}) {
  const base = await sharp(path.join(PUB, bgFile))
    .resize(SIZE, SIZE, { kernel: 'nearest', fit: 'cover' })
    .modulate({ brightness })
    .toBuffer();
  if (!tintR && !tintG && !tintB) return base;
  return sharp(base).composite([{
    input: { create: { width: SIZE, height: SIZE, channels: 4,
      background: { r: tintR, g: tintG, b: tintB, alpha: 80 } } },
    blend: 'over'
  }]).png().toBuffer();
}

/** Extract first frame from a spritesheet */
async function extractFrame(file, w, h) {
  return sharp(path.join(PUB, file))
    .extract({ left: 0, top: 0, width: w, height: h })
    .png().toBuffer();
}

/** Scale an icon file to target size with nearest-neighbor */
async function scaleIcon(file, s) {
  return sharp(path.join(PUB, file))
    .resize(s, s, { kernel: 'nearest' })
    .png().toBuffer();
}

/** Resize a buffer */
async function resizeBuf(buf, w, h) {
  return sharp(buf).resize(w, h, { kernel: 'nearest' }).png().toBuffer();
}

/** Get a spirit sprite cropped to content and scaled to targetSize */
async function getSpirit(type, targetSize = 48) {
  const b = SPIRIT_BOUNDS[type];
  const fullFrame = await extractFrame(SPIRIT_FILES[type], 64, 64);
  const cropped = await sharp(fullFrame).extract(b).png().toBuffer();
  const scale = Math.min(targetSize / b.width, targetSize / b.height);
  const nw = Math.round(b.width * scale), nh = Math.round(b.height * scale);
  return { buf: await resizeBuf(cropped, nw, nh), w: nw, h: nh };
}

/** Get an orb sprite cropped to content and scaled */
async function getOrb(type, targetSize = 44) {
  const b = ORB_BOUNDS[type];
  const cropped = await sharp(path.join(PUB, ORB_FILES[type])).extract(b).png().toBuffer();
  const scale = Math.min(targetSize / b.width, targetSize / b.height);
  const nw = Math.round(b.width * scale), nh = Math.round(b.height * scale);
  return { buf: await resizeBuf(cropped, nw, nh), w: nw, h: nh };
}

/** Get a boss sprite first-frame scaled to fit targetSize */
async function getBoss(type, targetSize = 44) {
  const { file, w, h } = BOSS_FRAMES[type];
  const frame = await extractFrame(file, w, h);
  const scale = Math.min(targetSize / w, targetSize / h);
  const nw = Math.round(w * scale), nh = Math.round(h * scale);
  return { buf: await resizeBuf(frame, nw, nh), w: nw, h: nh };
}

/** Compose layers onto a base buffer */
async function compose(baseBuf, layers) {
  return sharp(baseBuf).composite(
    layers.map(l => ({ input: l.input, left: l.x || 0, top: l.y || 0, blend: l.blend || 'over' }))
  ).png().toBuffer();
}

/** Add border and save icon */
async function saveIcon(name, baseBuf, borderColor = 'gold') {
  const colors = { gold: '212,168,67', red: '232,96,48', blue: '80,160,224',
    green: '80,192,112', purple: '160,100,220' };
  const c = colors[borderColor] || colors.gold;
  const svg = `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="${SIZE}" height="${SIZE}" rx="4" fill="none" stroke="rgba(${c},0.7)" stroke-width="2"/>
  </svg>`;
  const border = await sharp(Buffer.from(svg)).png().toBuffer();
  const final = await compose(baseBuf, [{ input: border }]);
  await sharp(final).png().toFile(path.join(OUT, `${name}.png`));
  console.log(`  ✓ ${name}`);
}

/** Number badge (e.g. "50", "100", "10K") */
async function badge(text) {
  const w = text.length * 8 + 8;
  const svg = `<svg width="${w}" height="14" xmlns="http://www.w3.org/2000/svg">
    <rect width="${w}" height="14" rx="3" fill="rgb(212,168,67)"/>
    <text x="${w / 2}" y="11" text-anchor="middle" font-family="monospace"
      font-size="10" font-weight="bold" fill="#0d0d1a">${text}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Upgrade star row */
async function starRow(filled, total = 3, starSize = 14) {
  const sf = await scaleIcon('upgrade-star.png', starSize);
  const se = await scaleIcon('upgrade-star-slot.png', starSize);
  const gap = 2, rowW = total * starSize + (total - 1) * gap;
  const layers = [];
  for (let i = 0; i < total; i++)
    layers.push({ input: i < filled ? sf : se, left: i * (starSize + gap), top: 0 });
  const buf = await sharp({ create: { width: rowW, height: starSize, channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().composite(layers).toBuffer();
  return { buf, w: rowW, h: starSize };
}

/** Heal-effect-circle with color tint */
async function healCircle(r, g, b) {
  const c = await sharp(path.join(PUB, 'heal-effect-circle.png')).png().toBuffer();
  return sharp(c).composite([{
    input: { create: { width: 64, height: 64, channels: 4,
      background: { r, g, b, alpha: 60 } } }, blend: 'over'
  }]).png().toBuffer();
}

// ─── SVG helpers ────────────────────────────────────────────────────────────

function goldCoinSvg(cx, cy, r) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="rgb(212,168,50)" stroke="rgb(160,120,20)" stroke-width="1.5"/>
    <circle cx="${cx}" cy="${cy}" r="${r * 0.6}" fill="none" stroke="rgba(255,220,80,0.5)" stroke-width="1"/>
    <text x="${cx}" y="${cy + 3}" text-anchor="middle" font-family="serif" font-size="${r}" font-weight="bold" fill="rgb(140,100,20)">G</text>`;
}

async function bigCoin(size = 32) {
  const r = size / 2;
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">${goldCoinSvg(r, r, r - 2)}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function goldPile(count) {
  const positions = [
    [[32, 36, 11]],
    [[22, 34, 10], [42, 34, 10]],
    [[18, 38, 10], [32, 30, 11], [46, 38, 10]],
    [[14, 40, 9], [28, 34, 10], [42, 28, 11], [50, 40, 9]],
    [[10, 42, 9], [24, 36, 10], [32, 26, 11], [42, 36, 10], [54, 42, 9]],
  ];
  const coins = positions[Math.min(count, 5) - 1];
  const svg = `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
    ${coins.map(([x, y, r]) => goldCoinSvg(x, y, r)).join('\n')}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function skullSvg(size) {
  return `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <circle cx="${size/2}" cy="${size*0.4}" r="${size*0.32}" fill="rgba(220,200,180,0.9)"/>
    <rect x="${size*0.25}" y="${size*0.55}" width="${size*0.5}" height="${size*0.2}" rx="2" fill="rgba(220,200,180,0.9)"/>
    <circle cx="${size*0.35}" cy="${size*0.35}" r="${size*0.08}" fill="rgba(13,13,26,0.9)"/>
    <circle cx="${size*0.65}" cy="${size*0.35}" r="${size*0.08}" fill="rgba(13,13,26,0.9)"/>
    <line x1="${size*0.35}" y1="${size*0.8}" x2="${size*0.35}" y2="${size}" stroke="rgba(220,200,180,0.9)" stroke-width="${size*0.06}"/>
    <line x1="${size*0.5}" y1="${size*0.8}" x2="${size*0.5}" y2="${size}" stroke="rgba(220,200,180,0.9)" stroke-width="${size*0.06}"/>
    <line x1="${size*0.65}" y1="${size*0.8}" x2="${size*0.65}" y2="${size}" stroke="rgba(220,200,180,0.9)" stroke-width="${size*0.06}"/>
  </svg>`;
}

function explosionSvg(size, c1 = '255,200,60', c2 = '232,96,48') {
  const cx = size / 2, cy = size / 2, oR = size * 0.45, iR = size * 0.22;
  let d = '';
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8 - Math.PI / 2;
    const r = i % 2 === 0 ? oR : iR;
    d += (i === 0 ? 'M' : 'L') + (cx + r * Math.cos(a)).toFixed(1) + ',' + (cy + r * Math.sin(a)).toFixed(1);
  }
  return `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <path d="${d}Z" fill="rgba(${c1},0.9)" stroke="rgba(${c2},0.8)" stroke-width="2"/>
    <circle cx="${cx}" cy="${cy}" r="${size * 0.12}" fill="rgba(255,255,220,0.8)"/>
  </svg>`;
}

function energyOrbSvg(size, r = 180, g = 220, b = 255) {
  const h = size / 2;
  return `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <circle cx="${h}" cy="${h}" r="${h - 2}" fill="rgba(${r},${g},${b},0.8)"/>
    <circle cx="${h}" cy="${h}" r="${h - 4}" fill="rgba(255,255,255,0.4)"/>
    <circle cx="${h - 1}" cy="${h - 1}" r="${size / 4}" fill="rgba(255,255,255,0.6)"/>
  </svg>`;
}

function xMarkSvg(size) {
  return `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <line x1="3" y1="3" x2="${size-3}" y2="${size-3}" stroke="rgba(230,60,60,0.9)" stroke-width="4" stroke-linecap="round"/>
    <line x1="${size-3}" y1="3" x2="3" y2="${size-3}" stroke="rgba(230,60,60,0.9)" stroke-width="4" stroke-linecap="round"/>
  </svg>`;
}

// Centering helpers
const cx = w => Math.floor((SIZE - w) / 2);
const cy = (h, off = 0) => Math.floor((SIZE - h) / 2) + off;

// ═══════════════════════════════════════════════════════════════════════════
// GENERATE ALL ACHIEVEMENTS
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  console.log('Generating achievement icons...\n');

  // ── QUESTS ──
  console.log('[Quests]');
  {
    const bg = await cropBg('bg-grass.png', { brightness: 0.3 });
    const s = await getSpirit('phys', 48);
    await saveIcon('first-quest', await compose(bg, [{ input: s.buf, x: cx(s.w), y: cy(s.h) }]));
  }
  {
    const bg = await cropBg('bg-desert.png', { brightness: 0.3 });
    const s = await getSpirit('fire', 44);
    const b = await badge('10');
    await saveIcon('seasoned-adventurer', await compose(bg, [
      { input: s.buf, x: cx(s.w), y: cy(s.h, -4) }, { input: b, x: SIZE - 28, y: SIZE - 16 }]));
  }

  // Novice Explorer — 5 quests
  {
    const bg = await cropBg('bg-grass.png', { brightness: 0.3 });
    const s = await getSpirit('def', 44);
    const b = await badge('5');
    await saveIcon('novice-explorer', await compose(bg, [
      { input: s.buf, x: cx(s.w), y: cy(s.h, -4) }, { input: b, x: SIZE - 24, y: SIZE - 16 }]));
  }
  // Experienced Adventurer — 15 quests
  {
    const bg = await cropBg('bg-tundra.png', { brightness: 0.3 });
    const s = await getSpirit('ice', 44);
    const b = await badge('15');
    await saveIcon('experienced-adventurer', await compose(bg, [
      { input: s.buf, x: cx(s.w), y: cy(s.h, -4) }, { input: b, x: SIZE - 28, y: SIZE - 16 }]));
  }
  // Skilled Explorer — 20 quests
  {
    const bg = await cropBg('bg-desert.png', { brightness: 0.3 });
    const s = await getSpirit('phys', 44);
    const b = await badge('20');
    await saveIcon('skilled-explorer', await compose(bg, [
      { input: s.buf, x: cx(s.w), y: cy(s.h, -4) }, { input: b, x: SIZE - 28, y: SIZE - 16 }]));
  }
  // Expert Explorer — 25 quests
  {
    const bg = await cropBg('bg-cave.png', { brightness: 0.3 });
    const s = await getSpirit('fire', 44);
    const b = await badge('25');
    await saveIcon('expert-explorer', await compose(bg, [
      { input: s.buf, x: cx(s.w), y: cy(s.h, -4) }, { input: b, x: SIZE - 28, y: SIZE - 16 }]));
  }
  // Veteran Explorer — 30 quests
  {
    const bg = await cropBg('bg-cave.png', { brightness: 0.3 });
    const s = await getSpirit('ice', 44);
    const b = await badge('30');
    await saveIcon('veteran-explorer', await compose(bg, [
      { input: s.buf, x: cx(s.w), y: cy(s.h, -4) }, { input: b, x: SIZE - 28, y: SIZE - 16 }]));
  }
  // Quest Master — 50 quests
  {
    const bg = await cropBg('bg-hub1.png', { brightness: 0.25 });
    const circle = await healCircle(212, 168, 67);
    const s = await getSpirit('phys', 44);
    const b = await badge('50');
    await saveIcon('quest-master', await compose(bg, [
      { input: circle }, { input: s.buf, x: cx(s.w), y: cy(s.h, -4) },
      { input: b, x: SIZE - 28, y: SIZE - 16 }]), 'gold');
  }
  // Legendary Explorer — 100 quests
  {
    const bg = await cropBg('bg-hub1.png', { brightness: 0.15 });
    const circle = await healCircle(212, 168, 67);
    const s = await getSpirit('fire', 44);
    const b = await badge('100');
    await saveIcon('legendary-explorer', await compose(bg, [
      { input: circle }, { input: s.buf, x: cx(s.w), y: cy(s.h, -4) },
      { input: b, x: SIZE - 32, y: SIZE - 16 }]), 'gold');
  }
  {
    const bg = await cropBg('bg-hub1.png', { brightness: 0.15 });
    const o1 = await getOrb('def', 28);
    const o2 = await getOrb('fire', 28);
    const o3 = await getOrb('ice', 28);
    await saveIcon('multitasker', await compose(bg, [
      { input: o1.buf, x: 2, y: cy(o1.h) },
      { input: o2.buf, x: cx(o2.w), y: cy(o2.h) },
      { input: o3.buf, x: SIZE - o3.w - 2, y: cy(o3.h) }]));
  }

  // ── BIOME MASTERY ──
  console.log('[Biome Mastery]');
  for (const [name, bgFile, boss] of [
    ['grasslands-conqueror', 'bg-grass.png', 'dragon'],
    ['desert-conqueror', 'bg-desert.png', 'sphinx'],
    ['tundra-conqueror', 'bg-tundra.png', 'abominable'],
    ['cave-conqueror', 'bg-cave.png', 'enigma'],
  ]) {
    const bg = await cropBg(bgFile, { brightness: 0.35 });
    const b = await getBoss(boss, 44);
    const stars = await starRow(3, 3, 10);
    await saveIcon(name, await compose(bg, [
      { input: b.buf, x: cx(b.w), y: cy(b.h) - 4 },
      { input: stars.buf, x: cx(stars.w), y: SIZE - stars.h - 4 }]));
  }
  {
    const half = SIZE / 2;
    const q1 = await cropBg('bg-grass.png', { brightness: 0.5 });
    const q2 = await cropBg('bg-desert.png', { brightness: 0.5 });
    const q3 = await cropBg('bg-tundra.png', { brightness: 0.5 });
    const q4 = await cropBg('bg-cave.png', { brightness: 0.5 });
    const tl = await sharp(q1).extract({ left: 0, top: 0, width: half, height: half }).toBuffer();
    const tr = await sharp(q2).extract({ left: half, top: 0, width: half, height: half }).toBuffer();
    const bl = await sharp(q3).extract({ left: 0, top: half, width: half, height: half }).toBuffer();
    const br = await sharp(q4).extract({ left: half, top: half, width: half, height: half }).toBuffer();
    const divSvg = `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
      <line x1="${half}" y1="0" x2="${half}" y2="${SIZE}" stroke="rgba(212,168,67,0.6)" stroke-width="2"/>
      <line x1="0" y1="${half}" x2="${SIZE}" y2="${half}" stroke="rgba(212,168,67,0.6)" stroke-width="2"/>
    </svg>`;
    const combined = await sharp({ create: { width: SIZE, height: SIZE, channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 255 } } }).png().composite([
      { input: tl, left: 0, top: 0 }, { input: tr, left: half, top: 0 },
      { input: bl, left: 0, top: half }, { input: br, left: half, top: half },
      { input: await sharp(Buffer.from(divSvg)).png().toBuffer(), left: 0, top: 0 },
    ]).toBuffer();
    const crownSvg = `<svg width="24" height="16" xmlns="http://www.w3.org/2000/svg">
      <polygon points="2,14 4,6 8,10 12,2 16,10 20,6 22,14" fill="rgba(212,168,67,0.9)" stroke="rgba(180,140,40,1)" stroke-width="1"/>
    </svg>`;
    const stars = await starRow(3, 3, 8);
    await saveIcon('world-conqueror', await compose(combined, [
      { input: await sharp(Buffer.from(crownSvg)).png().toBuffer(), x: 20, y: 16 },
      { input: stars.buf, x: cx(stars.w), y: SIZE - stars.h - 4 }]), 'gold');
  }

  // ── DIFFICULTY ──
  console.log('[Difficulty]');
  for (const [name, bgFile, tint, n, bc] of [
    ['frontier-scout', 'bg-grass.png', { tintG: 80 }, 1, 'green'],
    ['interior-breacher', 'bg-desert.png', { tintR: 100, tintG: 80 }, 2, 'gold'],
    ['stronghold-crusher', 'bg-cave.png', { tintR: 120 }, 3, 'red'],
  ]) {
    const bg = await cropBg(bgFile, { brightness: 0.3, ...tint });
    const shield = await scaleIcon('hp-bar-shield.png', 32);
    const stars = await starRow(n, 3, 10);
    await saveIcon(name, await compose(bg, [
      { input: shield, x: 16, y: 10 },
      { input: stars.buf, x: cx(stars.w), y: SIZE - stars.h - 6 }]), bc);
  }

  // ── BOSS COMBAT ──
  console.log('[Boss Combat]');
  {
    const bg = await cropBg('bg-grass.png', { brightness: 0.25 });
    const circle = await healCircle(212, 168, 67);
    const s = await getSpirit('def', 48);
    await saveIcon('flawless-victory', await compose(bg, [
      { input: circle }, { input: s.buf, x: cx(s.w), y: cy(s.h) }]), 'gold');
  }
  {
    const bg = await cropBg('bg-cave.png', { brightness: 0.25, tintR: 150 });
    const s = await getSpirit('phys', 44);
    const shield = await scaleIcon('hp-bar-shield.png', 24);
    await saveIcon('close-call', await compose(bg, [
      { input: s.buf, x: cx(s.w) - 4, y: cy(s.h, -4) },
      { input: shield, x: SIZE - 28, y: SIZE - 28 }]), 'red');
  }
  {
    const bg = await cropBg('bg-hub1.png', { brightness: 0.25 });
    const s = await getSpirit('fire', 44);
    const b = await badge('10');
    await saveIcon('no-retreat', await compose(bg, [
      { input: s.buf, x: cx(s.w), y: cy(s.h, -4) },
      { input: b, x: SIZE - 28, y: SIZE - 16 }]));
  }

  // ── LOSSES & RESILIENCE ──
  console.log('[Losses & Resilience]');
  {
    const bg = await cropBg('bg-cave.png', { brightness: 0.25 });
    const s = await getSpirit('def', 48);
    const xm = await sharp(Buffer.from(`<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
      <line x1="12" y1="12" x2="52" y2="52" stroke="rgba(220,40,40,0.7)" stroke-width="6" stroke-linecap="round"/>
      <line x1="52" y1="12" x2="12" y2="52" stroke="rgba(220,40,40,0.7)" stroke-width="6" stroke-linecap="round"/>
    </svg>`)).png().toBuffer();
    await saveIcon('fallen-hero', await compose(bg, [
      { input: s.buf, x: cx(s.w), y: cy(s.h) }, { input: xm }]), 'red');
  }
  {
    const bg = await cropBg('bg-grass.png', { brightness: 0.3 });
    const s = await getSpirit('phys', 44);
    const arrow = await sharp(await scaleIcon('arrow.png', 20)).rotate(-90).toBuffer();
    await saveIcon('persistence', await compose(bg, [
      { input: s.buf, x: cx(s.w) - 4, y: cy(s.h) },
      { input: arrow, x: SIZE - 24, y: 6 }]), 'green');
  }
  {
    const bg = await cropBg('bg-hub1.png', { brightness: 0.25 });
    const s = await getSpirit('def', 44);
    const arrow = await sharp(await scaleIcon('arrow.png', 20)).flop().toBuffer();
    await saveIcon('tactical-retreat', await compose(bg, [
      { input: s.buf, x: cx(s.w) + 4, y: cy(s.h) },
      { input: arrow, x: 2, y: 22 }]));
  }

  // ── BATTLE MILESTONES ──
  console.log('[Battle Milestones]');
  {
    const bg = await cropBg('bg-grass.png', { brightness: 0.25 });
    const sword = await scaleIcon('physical.png', 40);
    await saveIcon('first-blood', await compose(bg, [{ input: sword, x: 12, y: 12 }]));
  }
  for (const [name, bgFile, tint, text, bc] of [
    ['battle-hardened', 'bg-desert.png', {}, '50', 'gold'],
    ['warmonger', 'bg-tundra.png', { tintR: 80 }, '100', 'red'],
    ['grizzled-veteran', 'bg-cave.png', { tintR: 100 }, '250', 'red'],
  ]) {
    const bg = await cropBg(bgFile, { brightness: 0.25, ...tint });
    const sword = await scaleIcon('physical.png', 36);
    const b = await badge(text);
    await saveIcon(name, await compose(bg, [
      { input: sword, x: 10, y: 6 },
      { input: b, x: SIZE - text.length * 8 - 10, y: SIZE - 16 }]), bc);
  }

  // ── BATTLE FEATS ──
  console.log('[Battle Feats]');
  {
    const bg = await cropBg('bg-grass.png', { brightness: 0.25 });
    const s = await getSpirit('fire', 44);
    const arr = await scaleIcon('arrow.png', 16);
    await saveIcon('speed-demon', await compose(bg, [
      { input: s.buf, x: cx(s.w) - 4, y: cy(s.h) },
      { input: arr, x: SIZE - 20, y: 12 }, { input: arr, x: SIZE - 20, y: 30 }]));
  }
  {
    const bg = await cropBg('bg-cave.png', { brightness: 0.2 });
    const circle = await healCircle(100, 100, 140);
    const s = await getSpirit('def', 44);
    await saveIcon('marathon-fight', await compose(bg, [
      { input: circle }, { input: s.buf, x: cx(s.w), y: cy(s.h) }]));
  }
  {
    const bg = await cropBg('bg-desert.png', { brightness: 0.3 });
    const circle = await healCircle(80, 160, 224);
    const s = await getSpirit('def', 44);
    await saveIcon('untouchable', await compose(bg, [
      { input: circle }, { input: s.buf, x: cx(s.w), y: cy(s.h) }]), 'blue');
  }
  {
    const bg = await cropBg('bg-cave.png', { brightness: 0.2, tintR: 120 });
    const s = await getSpirit('phys', 44);
    const shield = await scaleIcon('hp-bar-shield.png', 24);
    await saveIcon('survivor', await compose(bg, [
      { input: s.buf, x: cx(s.w) - 4, y: cy(s.h, -4) },
      { input: shield, x: SIZE - 28, y: SIZE - 28 }]), 'red');
  }

  // ── COMBAT TOTALS ──
  console.log('[Combat Totals]');
  // Dragon head crop (zoomed to face) — used for kill achievements
  const dragonFullFrame = await extractFrame('enemy-boss-dragon-1.png', 145, 97);
  const dragonHeadBuf = await sharp(dragonFullFrame)
    .extract({ left: 0, top: 5, width: 75, height: 70 }).png().toBuffer();
  {
    const bg = await cropBg('bg-grass.png', { brightness: 0.2 });
    const dragonHead = await resizeBuf(dragonHeadBuf, 48, 44);
    const sword = await scaleIcon('physical.png', 20);
    const b = await badge('100');
    await saveIcon('slayer', await compose(bg, [
      { input: dragonHead, x: 4, y: 2 }, { input: sword, x: 4, y: SIZE - 24 },
      { input: b, x: SIZE - 32, y: SIZE - 16 }]));
  }
  {
    const bg = await cropBg('bg-cave.png', { brightness: 0.15, tintR: 100 });
    const dragonHead = await resizeBuf(dragonHeadBuf, 56, 52);
    const b = await badge('500');
    await saveIcon('annihilator', await compose(bg, [
      { input: dragonHead, x: 4, y: 2 }, { input: b, x: SIZE - 32, y: SIZE - 16 }]), 'red');
  }
  {
    const bg = await cropBg('bg-hub1.png', { brightness: 0.2 });
    const shield = await scaleIcon('hp-bar-shield.png', 36);
    const b = await badge('500');
    await saveIcon('round-veteran', await compose(bg, [
      { input: shield, x: 14, y: 8 }, { input: b, x: SIZE - 32, y: SIZE - 16 }]));
  }

  // ── SPIRIT COLLECTION ──
  console.log('[Spirit Collection]');
  {
    const bg = await cropBg('bg-hub1.png', { brightness: 0.15 });
    const o = await getOrb('fire', 48);
    await saveIcon('spirit-caller', await compose(bg, [{ input: o.buf, x: cx(o.w), y: cy(o.h) }]));
  }
  {
    const bg = await cropBg('bg-hub1.png', { brightness: 0.15 });
    const o = await getOrb('ice', 44);
    const b = await badge('25');
    await saveIcon('spirit-collector', await compose(bg, [
      { input: o.buf, x: cx(o.w) - 4, y: cy(o.h) - 4 },
      { input: b, x: SIZE - 28, y: SIZE - 16 }]));
  }
  {
    const bg = await cropBg('bg-hub1.png', { brightness: 0.15 });
    const circle = await healCircle(160, 120, 220);
    const o = await getOrb('phys', 44);
    const b = await badge('50');
    await saveIcon('spirit-hoarder', await compose(bg, [
      { input: circle }, { input: o.buf, x: cx(o.w) - 4, y: cy(o.h) - 4 },
      { input: b, x: SIZE - 28, y: SIZE - 16 }]), 'purple');
  }
  {
    const bg = await cropBg('bg-hub1.png', { brightness: 0.2 });
    const f = await scaleIcon('fire.png', 24);
    const i = await scaleIcon('ice.png', 24);
    const p = await scaleIcon('physical.png', 24);
    const bl = await scaleIcon('block.png', 24);
    await saveIcon('full-arsenal', await compose(bg, [
      { input: f, x: 4, y: 4 }, { input: i, x: 36, y: 4 },
      { input: p, x: 4, y: 36 }, { input: bl, x: 36, y: 36 }]));
  }

  // ── DECK BUILDING ──
  console.log('[Deck Building]');
  {
    const bg = await cropBg('bg-desert.png', { brightness: 0.25, tintR: 120 });
    const s = await getSpirit('fire', 48);
    const f = await scaleIcon('fire.png', 20);
    await saveIcon('mono-fire', await compose(bg, [
      { input: s.buf, x: cx(s.w), y: cy(s.h, -4) },
      { input: f, x: SIZE - 24, y: SIZE - 24 }]), 'red');
  }
  {
    const bg = await cropBg('bg-tundra.png', { brightness: 0.25, tintB: 100 });
    const s = await getSpirit('ice', 48);
    const i = await scaleIcon('ice.png', 20);
    await saveIcon('mono-ice', await compose(bg, [
      { input: s.buf, x: cx(s.w), y: cy(s.h, -4) },
      { input: i, x: SIZE - 24, y: SIZE - 24 }]), 'blue');
  }
  {
    const bg = await cropBg('bg-cave.png', { brightness: 0.25, tintR: 80 });
    const s = await getSpirit('fire', 44);
    const bl = await scaleIcon('block.png', 24);
    const xm = await sharp(Buffer.from(xMarkSvg(24))).png().toBuffer();
    await saveIcon('glass-cannon', await compose(bg, [
      { input: s.buf, x: cx(s.w) - 4, y: cy(s.h, -6) },
      { input: bl, x: SIZE - 28, y: SIZE - 28 },
      { input: xm, x: SIZE - 28, y: SIZE - 28 }]), 'red');
  }
  {
    const bg = await cropBg('bg-grass.png', { brightness: 0.25 });
    const s = await getSpirit('phys', 48);
    const p = await scaleIcon('physical.png', 20);
    await saveIcon('mono-physical', await compose(bg, [
      { input: s.buf, x: cx(s.w), y: cy(s.h, -4) },
      { input: p, x: SIZE - 24, y: SIZE - 24 }]));
  }

  // ── UPGRADES ──
  console.log('[Upgrades]');
  {
    const bg = await cropBg('bg-shop.png', { brightness: 0.2 });
    const o = await getOrb('phys', 44);
    const star = await scaleIcon('upgrade-star.png', 16);
    await saveIcon('apprentice-smith', await compose(bg, [
      { input: o.buf, x: cx(o.w), y: cy(o.h) - 4 },
      { input: star, x: SIZE - 20, y: SIZE - 20 }]));
  }
  {
    const bg = await cropBg('bg-shop.png', { brightness: 0.25 });
    const o = await getOrb('fire', 44);
    const star = await scaleIcon('upgrade-star.png', 14);
    await saveIcon('journeyman-smith', await compose(bg, [
      { input: o.buf, x: cx(o.w), y: cy(o.h) - 4 },
      { input: star, x: SIZE - 34, y: SIZE - 18 },
      { input: star, x: SIZE - 18, y: SIZE - 18 }]));
  }
  {
    const bg = await cropBg('bg-shop.png', { brightness: 0.3 });
    const o = await getOrb('ice', 44);
    const star = await scaleIcon('upgrade-star.png', 14);
    await saveIcon('master-smith', await compose(bg, [
      { input: o.buf, x: cx(o.w), y: cy(o.h) - 4 },
      { input: star, x: SIZE - 46, y: SIZE - 18 },
      { input: star, x: SIZE - 30, y: SIZE - 18 },
      { input: star, x: SIZE - 14, y: SIZE - 18 }]));
  }
  {
    const bg = await cropBg('bg-hub1.png', { brightness: 0.2 });
    const s = await getSpirit('phys', 44);
    const stars = await starRow(2, 3, 12);
    await saveIcon('rising-star', await compose(bg, [
      { input: s.buf, x: cx(s.w), y: cy(s.h, -6) },
      { input: stars.buf, x: cx(stars.w), y: SIZE - stars.h - 4 }]));
  }
  {
    const bg = await cropBg('bg-hub1.png', { brightness: 0.2 });
    const circle = await healCircle(212, 168, 67);
    const s = await getSpirit('fire', 44);
    const stars = await starRow(3, 3, 12);
    await saveIcon('perfection', await compose(bg, [
      { input: circle }, { input: s.buf, x: cx(s.w), y: cy(s.h, -6) },
      { input: stars.buf, x: cx(stars.w), y: SIZE - stars.h - 4 }]), 'gold');
  }
  {
    const bg = await cropBg('bg-shop.png', { brightness: 0.2 });
    const circle = await healCircle(212, 168, 67);
    const o = await getOrb('fire', 44);
    const star = await scaleIcon('upgrade-star.png', 14);
    await saveIcon('master-forger', await compose(bg, [
      { input: circle }, { input: o.buf, x: cx(o.w), y: cy(o.h) - 4 },
      { input: star, x: SIZE - 46, y: SIZE - 18 },
      { input: star, x: SIZE - 30, y: SIZE - 18 },
      { input: star, x: SIZE - 14, y: SIZE - 18 }]), 'gold');
  }
  {
    const bg = await cropBg('bg-hub1.png', { brightness: 0.2 });
    const f = await scaleIcon('fire.png', 24);
    const i = await scaleIcon('ice.png', 24);
    const p = await scaleIcon('physical.png', 24);
    const stars = await starRow(3, 3, 10);
    await saveIcon('max-power', await compose(bg, [
      { input: p, x: 4, y: 12 }, { input: f, x: 22, y: 12 }, { input: i, x: 40, y: 12 },
      { input: stars.buf, x: cx(stars.w), y: SIZE - stars.h - 6 }]), 'gold');
  }

  // ── UPGRADE BY TYPE ──
  console.log('[Upgrade by Type]');
  for (const [name, orbType, elemFile, bc] of [
    ['pyro-forger', 'fire', 'fire.png', 'red'],
    ['cryo-forger', 'ice', 'ice.png', 'blue'],
    ['weapons-forger', 'phys', 'physical.png', 'gold'],
    ['shield-forger', 'def', 'block.png', 'blue'],
  ]) {
    const bg = await cropBg('bg-shop.png', { brightness: 0.2 });
    const o = await getOrb(orbType, 40);
    const elem = await scaleIcon(elemFile, 20);
    const b = await badge('10');
    await saveIcon(name, await compose(bg, [
      { input: o.buf, x: cx(o.w) - 4, y: cy(o.h) - 6 },
      { input: elem, x: 4, y: SIZE - 24 },
      { input: b, x: SIZE - 28, y: SIZE - 16 }]), bc);
  }

  // ── ECONOMY ──
  console.log('[Economy]');
  {
    const bg = await cropBg('bg-shop.png', { brightness: 0.18 });
    const coin = await bigCoin(36);
    await saveIcon('first-coin', await compose(bg, [{ input: coin, x: 14, y: 14 }]));
  }
  {
    const bg = await cropBg('bg-shop.png', { brightness: 0.18 });
    const pile = await goldPile(3);
    const b = await badge('500');
    await saveIcon('treasure-hunter', await compose(bg, [
      { input: pile, x: 0, y: -4 }, { input: b, x: SIZE - 32, y: SIZE - 16 }]));
  }
  {
    const bg = await cropBg('bg-shop.png', { brightness: 0.15 });
    const pile = await goldPile(5);
    await saveIcon('golden-hoard', await compose(bg, [{ input: pile }]), 'gold');
  }
  {
    const bg = await cropBg('bg-cave.png', { brightness: 0.15 });
    const circle = await healCircle(212, 168, 67);
    const pile = await goldPile(5);
    const b = await badge('10K');
    await saveIcon('dragons-vault', await compose(bg, [
      { input: circle }, { input: pile }, { input: b, x: SIZE - 30, y: 4 }]), 'gold');
  }
  {
    const bg = await cropBg('bg-shop.png', { brightness: 0.18 });
    const coin = await bigCoin(30);
    const arrow = await scaleIcon('arrow.png', 20);
    await saveIcon('big-spender', await compose(bg, [
      { input: coin, x: 8, y: 16 }, { input: arrow, x: SIZE - 26, y: 20 }]));
  }
  {
    const bg = await cropBg('bg-shop.png', { brightness: 0.18 });
    const o = await getOrb('def', 32);
    const arrow = await scaleIcon('arrow.png', 16);
    const coin = await bigCoin(24);
    await saveIcon('merchant', await compose(bg, [
      { input: o.buf, x: 4, y: cy(o.h) },
      { input: arrow, x: 24, y: 24 }, { input: coin, x: 38, y: 18 }]));
  }
  {
    const bg = await cropBg('bg-shop.png', { brightness: 0.18 });
    const o = await getOrb('fire', 32);
    const coin = await bigCoin(24);
    const b = await badge('50');
    await saveIcon('spirit-trader', await compose(bg, [
      { input: o.buf, x: 4, y: cy(o.h) - 4 },
      { input: coin, x: 34, y: 14 }, { input: b, x: SIZE - 28, y: SIZE - 16 }]));
  }

  // ── SELLING BY TYPE ──
  console.log('[Selling by Type]');
  for (const [name, orbType, elemFile, bc] of [
    ['fire-sale', 'fire', 'fire.png', 'red'],
    ['cold-surplus', 'ice', 'ice.png', 'blue'],
    ['disarmed', 'phys', 'physical.png', 'gold'],
    ['shields-down', 'def', 'block.png', 'blue'],
  ]) {
    const bg = await cropBg('bg-shop.png', { brightness: 0.18 });
    const o = await getOrb(orbType, 32);
    const elem = await scaleIcon(elemFile, 18);
    const coin = await bigCoin(22);
    const b = await badge('15');
    await saveIcon(name, await compose(bg, [
      { input: o.buf, x: 4, y: cy(o.h) - 4 },
      { input: elem, x: 4, y: 4 },
      { input: coin, x: 36, y: 16 },
      { input: b, x: SIZE - 28, y: SIZE - 16 }]), bc);
  }

  // ── COMBAT MASTERY — Elemental ──
  console.log('[Combat Mastery — Elemental]');
  // Balanced Fighter — all 3 attack elements in loadout
  {
    const bg = await cropBg('bg-grass.png', { brightness: 0.2 });
    const f = await scaleIcon('fire.png', 24);
    const i = await scaleIcon('ice.png', 24);
    const p = await scaleIcon('physical.png', 24);
    await saveIcon('balanced-fighter', await compose(bg, [
      { input: p, x: 20, y: 4 }, { input: f, x: 4, y: 34 }, { input: i, x: 36, y: 34 }]));
  }
  // Elemental Focus — every attack ability same element
  {
    const bg = await cropBg('bg-desert.png', { brightness: 0.25 });
    const circle = await healCircle(212, 168, 67);
    const f = await scaleIcon('fire.png', 36);
    await saveIcon('elemental-focus', await compose(bg, [
      { input: circle }, { input: f, x: 14, y: 14 }]), 'gold');
  }
  // Full Spectrum — upgraded ability of every effect type
  {
    const bg = await cropBg('bg-hub1.png', { brightness: 0.2 });
    const f = await scaleIcon('fire.png', 20);
    const i = await scaleIcon('ice.png', 20);
    const p = await scaleIcon('physical.png', 20);
    const bl = await scaleIcon('block.png', 20);
    const stars = await starRow(1, 1, 12);
    await saveIcon('full-spectrum', await compose(bg, [
      { input: f, x: 4, y: 6 }, { input: i, x: 36, y: 6 },
      { input: p, x: 4, y: 32 }, { input: bl, x: 36, y: 32 },
      { input: stars.buf, x: cx(stars.w), y: cy(stars.h) }]), 'gold');
  }

  // ── COMBAT MASTERY — Energy ──
  console.log('[Combat Mastery — Energy]');
  // Energy Collector — own abilities generating all 3 energy colors
  {
    const bg = await cropBg('bg-hub1.png', { brightness: 0.18 });
    const orbR = await sharp(Buffer.from(energyOrbSvg(20, 230, 80, 80))).png().toBuffer();
    const orbG = await sharp(Buffer.from(energyOrbSvg(20, 80, 200, 80))).png().toBuffer();
    const orbB = await sharp(Buffer.from(energyOrbSvg(20, 80, 160, 230))).png().toBuffer();
    await saveIcon('energy-collector', await compose(bg, [
      { input: orbR, x: 6, y: 22 }, { input: orbG, x: 22, y: 10 },
      { input: orbB, x: 38, y: 22 }]));
  }
  // Energy Specialist — 3+ abilities same energy color
  {
    const bg = await cropBg('bg-hub1.png', { brightness: 0.15, tintB: 60 });
    const circle = await healCircle(80, 160, 224);
    const orb = await sharp(Buffer.from(energyOrbSvg(14, 140, 200, 255))).png().toBuffer();
    await saveIcon('energy-specialist', await compose(bg, [
      { input: circle },
      { input: orb, x: 16, y: 16 }, { input: orb, x: 34, y: 16 },
      { input: orb, x: 25, y: 36 }]), 'blue');
  }
  // Overcharged — 3+ loadout abilities same energy color
  {
    const bg = await cropBg('bg-hub1.png', { brightness: 0.15, tintR: 40, tintB: 80 });
    const circle = await healCircle(160, 100, 220);
    const orb = await sharp(Buffer.from(energyOrbSvg(12, 180, 200, 255))).png().toBuffer();
    await saveIcon('overcharged', await compose(bg, [
      { input: circle },
      { input: orb, x: 26, y: 4 }, { input: orb, x: 44, y: 18 },
      { input: orb, x: 40, y: 40 }, { input: orb, x: 18, y: 46 },
      { input: orb, x: 4, y: 28 }]), 'purple');
  }

  // ── COMBAT MASTERY — Damage ──
  console.log('[Combat Mastery — Damage]');
  // Damage Dealer — 300+ damage in single battle
  {
    const bg = await cropBg('bg-cave.png', { brightness: 0.2, tintR: 100 });
    const sword = await scaleIcon('physical.png', 40);
    const b = await badge('300');
    await saveIcon('damage-dealer', await compose(bg, [
      { input: sword, x: 8, y: 6 },
      { input: b, x: SIZE - 32, y: SIZE - 16 }]), 'red');
  }
  // Overwhelming Force — 600+ damage in single battle
  {
    const bg = await cropBg('bg-cave.png', { brightness: 0.15, tintR: 120 });
    const expl = await sharp(Buffer.from(explosionSvg(48))).png().toBuffer();
    const b = await badge('600');
    await saveIcon('overwhelming-force', await compose(bg, [
      { input: expl, x: 8, y: 4 },
      { input: b, x: SIZE - 32, y: SIZE - 16 }]), 'red');
  }
  // Devastator — 10000 total damage across all battles
  {
    const bg = await cropBg('bg-desert.png', { brightness: 0.2, tintR: 100 });
    const f = await scaleIcon('fire.png', 24);
    const p = await scaleIcon('physical.png', 24);
    const b = await badge('10K');
    await saveIcon('devastator', await compose(bg, [
      { input: p, x: 8, y: 10 }, { input: f, x: 30, y: 10 },
      { input: b, x: SIZE - 30, y: SIZE - 16 }]), 'red');
  }

  // ── COMBAT MASTERY — Loadout ──
  console.log('[Combat Mastery — Loadout]');
  // Fortified — 3+ block abilities in loadout
  {
    const bg = await cropBg('bg-tundra.png', { brightness: 0.25, tintB: 60 });
    const circle = await healCircle(80, 160, 224);
    const bl = await scaleIcon('block.png', 36);
    await saveIcon('fortified', await compose(bg, [
      { input: circle }, { input: bl, x: 14, y: 14 }]), 'blue');
  }
  // AOE Arsenal — 3+ AOE abilities
  {
    const bg = await cropBg('bg-cave.png', { brightness: 0.15 });
    const expl = await sharp(Buffer.from(explosionSvg(48))).png().toBuffer();
    const b = await badge('3+');
    await saveIcon('aoe-arsenal', await compose(bg, [
      { input: expl, x: 8, y: 4 }, { input: b, x: SIZE - 28, y: SIZE - 16 }]));
  }
  // Power Surge — battle with fully upgraded 3-star ability
  {
    const bg = await cropBg('bg-hub1.png', { brightness: 0.2 });
    const circle = await healCircle(212, 168, 67);
    const s = await getSpirit('fire', 44);
    const stars = await starRow(3, 3, 10);
    await saveIcon('power-surge', await compose(bg, [
      { input: circle }, { input: s.buf, x: cx(s.w), y: cy(s.h, -6) },
      { input: stars.buf, x: cx(stars.w), y: SIZE - stars.h - 4 }]), 'gold');
  }

  // ── Done ──
  const files = fs.readdirSync(OUT).filter(f => f.endsWith('.png'));
  console.log(`\nDone! Generated ${files.length} achievement icons in ${OUT}`);
}

main().catch(e => { console.error(e); process.exit(1); });
