// SpellCast letter values
export const LETTER_VALUES: Record<string, number> = {
  A: 1, E: 1, I: 1, O: 1,
  N: 2, R: 2, S: 2, T: 2,
  D: 3, G: 3, L: 3,
  B: 4, H: 4, M: 4, P: 4, U: 4, Y: 4,
  C: 5, F: 5, V: 5, W: 5,
  K: 6,
  J: 7, X: 7,
  Q: 8, Z: 8,
};

export const GRID = 5;
export const MIN_WORD_LEN = 3;
export const LONG_WORD_BONUS = 10; // 6+ letters, like SpellCast

export interface BoardTile {
  letter: string;
  /** letter multiplier: 1 or 2 (DL) */
  letterMult: number;
  /** word multiplier: 1 or 2 (2X) */
  wordMult: number;
  /** holds a collectible gem */
  gem: boolean;
}

export function scoreWord(tiles: BoardTile[], path: number[]): number {
  let sum = 0;
  let wordMult = 1;
  for (const idx of path) {
    const t = tiles[idx];
    sum += LETTER_VALUES[t.letter] * t.letterMult;
    if (t.wordMult > 1) wordMult = t.wordMult;
  }
  let total = sum * wordMult;
  if (path.length >= 6) total += LONG_WORD_BONUS;
  return total;
}

export function isAdjacent(a: number, b: number): boolean {
  const ar = Math.floor(a / GRID), ac = a % GRID;
  const br = Math.floor(b / GRID), bc = b % GRID;
  const dr = Math.abs(ar - br), dc = Math.abs(ac - bc);
  return dr <= 1 && dc <= 1 && !(dr === 0 && dc === 0);
}

/** Validates a path: indices in range, unique, consecutive cells adjacent. */
export function isValidPath(path: number[]): boolean {
  if (path.length < MIN_WORD_LEN) return false;
  const seen = new Set<number>();
  for (let i = 0; i < path.length; i++) {
    const idx = path[i];
    if (!Number.isInteger(idx) || idx < 0 || idx >= GRID * GRID) return false;
    if (seen.has(idx)) return false;
    seen.add(idx);
    if (i > 0 && !isAdjacent(path[i - 1], idx)) return false;
  }
  return true;
}

export function pathToWord(tiles: BoardTile[], path: number[]): string {
  return path.map((i) => tiles[i].letter).join('');
}
