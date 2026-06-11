import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BoardTile } from '../shared/scoring';
import { GRID } from '../shared/scoring';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let words: Set<string> | null = null;
let prefixes: Set<string> | null = null;

const MAX_HINT_LEN = 8;

export function getDictionary(): Set<string> {
  if (!words) {
    const file = path.join(__dirname, '..', 'public', 'dict', 'enable1.txt');
    const raw = readFileSync(file, 'utf8');
    words = new Set(raw.split(/\r?\n/).filter(Boolean).map((w) => w.toUpperCase()));
    console.log(`Dictionary loaded: ${words.size} words`);
  }
  return words;
}

/** All prefixes of words up to MAX_HINT_LEN letters — built lazily for the Hint solver. */
function getPrefixes(): Set<string> {
  if (!prefixes) {
    prefixes = new Set<string>();
    for (const w of getDictionary()) {
      if (w.length > MAX_HINT_LEN) continue;
      for (let i = 1; i <= w.length; i++) prefixes.add(w.slice(0, i));
    }
    console.log(`Hint prefix index built: ${prefixes.size} prefixes`);
  }
  return prefixes;
}

// adjacency lists for the 5x5 grid
const NEIGHBORS: number[][] = Array.from({ length: GRID * GRID }, (_, i) => {
  const r = Math.floor(i / GRID), c = i % GRID;
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < GRID && nc >= 0 && nc < GRID) out.push(nr * GRID + nc);
    }
  }
  return out;
});

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Finds a random valid word on the board (randomized DFS with prefix pruning).
 * Prefers 4+ letter words; falls back to a 3-letter word if that's all there is.
 */
export function findRandomWord(tiles: BoardTile[]): number[] | null {
  const dict = getDictionary();
  const pfx = getPrefixes();
  let fallback: number[] | null = null;

  const dfs = (pathArr: number[], word: string): number[] | null => {
    if (dict.has(word)) {
      if (word.length >= 4) return [...pathArr];
      if (!fallback && word.length >= 3) fallback = [...pathArr];
    }
    if (word.length >= MAX_HINT_LEN) return null;
    for (const n of shuffled(NEIGHBORS[pathArr[pathArr.length - 1]])) {
      if (pathArr.includes(n)) continue;
      const next = word + tiles[n].letter;
      if (!pfx.has(next)) continue;
      pathArr.push(n);
      const r = dfs(pathArr, next);
      pathArr.pop();
      if (r) return r;
    }
    return null;
  };

  for (const s of shuffled(Array.from({ length: GRID * GRID }, (_, i) => i))) {
    const r = dfs([s], tiles[s].letter);
    if (r) return r;
  }
  return fallback;
}
