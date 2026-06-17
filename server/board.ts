import type { BoardTile } from '../shared/scoring';
import { GRID } from '../shared/scoring';

// Letter distribution weighted for playable boards (roughly English frequency,
// vowels boosted slightly, rare letters kept rare).
const LETTER_BAG =
  'EEEEEEEEEEAAAAAAAAAIIIIIIIIOOOOOOONNNNNNRRRRRRTTTTTTTSSSSSSLLLLDDDDGGGUUUUCCCMMMHHHBBPPFFYYWWKVJXQZ';

const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);
const GEM_TILES_PER_BOARD = 4;
const REPLACE_GEM_CHANCE = 0.18;

function randomLetter(): string {
  return LETTER_BAG[Math.floor(Math.random() * LETTER_BAG.length)];
}

function pickRandomIdx(): number {
  return Math.floor(Math.random() * GRID * GRID);
}

/** A plain cascaded-in tile: random letter, no bonuses, chance of a gem. */
export function freshTile(): BoardTile {
  return { letter: randomLetter(), letterMult: 1, wordMult: 1, gem: Math.random() < REPLACE_GEM_CHANCE };
}

export function generateBoard(): BoardTile[] {
  const size = GRID * GRID;
  let letters: string[];
  // Re-roll until we get a reasonable vowel count (5-11)
  do {
    letters = Array.from({ length: size }, randomLetter);
  } while (!vowelCountOk(letters));

  const tiles: BoardTile[] = letters.map((letter) => ({
    letter,
    letterMult: 1,
    wordMult: 1,
    gem: false,
  }));

  // One letter boost (60% DL / 40% TL), one 2X Word tile, and a few gems, all on distinct cells.
  const special = pickDistinct(size, 2 + GEM_TILES_PER_BOARD);
  tiles[special[0]].letterMult = Math.random() < 0.6 ? 2 : 3;
  tiles[special[1]].wordMult = 2;
  for (let i = 2; i < special.length; i++) tiles[special[i]].gem = true;

  return tiles;
}

/**
 * Moves the 2x word boost to a completely random tile position (fully random,
 * can land on the same tile). Clears any existing word boost first.
 */
export function relocateWordBoost(tiles: BoardTile[]): void {
  for (const t of tiles) t.wordMult = 1;
  tiles[pickRandomIdx()].wordMult = 2;
}

/**
 * Flips the letter boost type (60% DL / 40% TL) and moves it to a completely
 * random tile position (fully random, can land on the same tile).
 * Clears any existing letter boost first.
 */
export function relocateLetterBoost(tiles: BoardTile[]): void {
  for (const t of tiles) t.letterMult = 1;
  tiles[pickRandomIdx()].letterMult = Math.random() < 0.6 ? 2 : 3;
}

/** In-place Fisher-Yates shuffle — tiles keep their bonuses/gems, only positions change. */
export function shuffleBoard(tiles: BoardTile[]): void {
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
}

function pickDistinct(size: number, count: number): number[] {
  const picked: number[] = [];
  while (picked.length < count) {
    const idx = Math.floor(Math.random() * size);
    if (!picked.includes(idx)) picked.push(idx);
  }
  return picked;
}

function vowelCountOk(letters: string[]): boolean {
  const v = letters.filter((l) => VOWELS.has(l)).length;
  return v >= 5 && v <= 11;
}
