import type { BoardTile } from '../shared/scoring';
import { GRID } from '../shared/scoring';

// Letter distribution weighted for playable boards (roughly English frequency,
// vowels boosted slightly, rare letters kept rare).
const LETTER_BAG =
  'EEEEEEEEEEAAAAAAAAAIIIIIIIIOOOOOOONNNNNNRRRRRRTTTTTTTSSSSSSLLLLDDDDGGGUUUUCCCMMMHHHBBPPFFYYWWKVJXQZ';

const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);

function randomLetter(): string {
  return LETTER_BAG[Math.floor(Math.random() * LETTER_BAG.length)];
}

export function generateBoard(): BoardTile[] {
  const size = GRID * GRID;
  let letters: string[];
  // Re-roll until we get a reasonable vowel count (5-10)
  do {
    letters = Array.from({ length: size }, randomLetter);
  } while (!vowelCountOk(letters));

  const tiles: BoardTile[] = letters.map((letter) => ({
    letter,
    letterMult: 1,
    wordMult: 1,
  }));

  // One Double Letter tile and one 2X Word tile, on distinct cells.
  const dlIdx = Math.floor(Math.random() * size);
  let dwIdx = Math.floor(Math.random() * size);
  while (dwIdx === dlIdx) dwIdx = Math.floor(Math.random() * size);
  tiles[dlIdx].letterMult = 2;
  tiles[dwIdx].wordMult = 2;

  return tiles;
}

function vowelCountOk(letters: string[]): boolean {
  const v = letters.filter((l) => VOWELS.has(l)).length;
  return v >= 5 && v <= 11;
}
