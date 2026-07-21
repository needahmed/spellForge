import type { BoardTile } from '../shared/scoring';
import { GRID } from '../shared/scoring';

// Letter distribution weighted for playable boards (roughly English frequency,
// vowels boosted slightly, rare letters kept rare).
const LETTER_BAG =
  'EEEEEEEEEEAAAAAAAAAIIIIIIIIOOOOOOONNNNNNRRRRRRTTTTTTTSSSSSSLLLLDDDDGGGUUUUCCCMMMHHHBBPPFFYYWWKVJXQZ';

const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);
export const GEM_TILES_PER_BOARD = 8;

function randomLetter(): string {
  return LETTER_BAG[Math.floor(Math.random() * LETTER_BAG.length)];
}

function pickRandomIdx(): number {
  return Math.floor(Math.random() * GRID * GRID);
}

/** A plain cascaded-in tile; gems are redistributed after the full cascade. */
export function freshTile(): BoardTile {
  return { letter: randomLetter(), letterMult: 1, wordMult: 1, gem: false };
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

  // Gems are separated by at least one cell in every direction. Bonuses use
  // other cells so all initial board features remain visually distinct.
  const gemIndices = pickSpreadIndices(GEM_TILES_PER_BOARD);
  const bonusIndices = pickDistinct(size, 2, new Set(gemIndices));
  tiles[bonusIndices[0]].letterMult = Math.random() < 0.6 ? 2 : 3;
  tiles[bonusIndices[1]].wordMult = 2;
  for (const idx of gemIndices) tiles[idx].gem = true;

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
  spreadGems(tiles);
}

/** Restores the named gem count using the same non-clustered board slots. */
export function spreadGems(tiles: BoardTile[]): void {
  for (const tile of tiles) tile.gem = false;
  for (const idx of pickSpreadIndices(GEM_TILES_PER_BOARD)) tiles[idx].gem = true;
}

function pickDistinct(size: number, count: number, excluded: ReadonlySet<number> = new Set()): number[] {
  const picked: number[] = [];
  while (picked.length < count) {
    const idx = Math.floor(Math.random() * size);
    if (!excluded.has(idx) && !picked.includes(idx)) picked.push(idx);
  }
  return picked;
}

function pickSpreadIndices(count: number): number[] {
  // Every other row and column gives each gem a full one-tile buffer, including
  // diagonals. A 5x5 board has nine such slots; one is randomly omitted at 8.
  const candidates: number[] = [];
  for (let row = 0; row < GRID; row += 2) {
    for (let col = 0; col < GRID; col += 2) candidates.push(row * GRID + col);
  }
  if (count > candidates.length) {
    throw new Error(`GEM_TILES_PER_BOARD cannot exceed ${candidates.length} with spread placement.`);
  }
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return candidates.slice(0, count);
}

function vowelCountOk(letters: string[]): boolean {
  const v = letters.filter((l) => VOWELS.has(l)).length;
  return v >= 5 && v <= 11;
}
