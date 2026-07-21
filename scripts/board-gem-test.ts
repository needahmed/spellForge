import assert from 'node:assert/strict';
import { freshTile, GEM_TILES_PER_BOARD, generateBoard, shuffleBoard, spreadGems } from '../server/board';
import { GRID } from '../shared/scoring';

function assertSpreadGems(board: ReturnType<typeof generateBoard>) {
  const gemIndices = board.flatMap((tile, idx) => tile.gem ? [idx] : []);

  assert.equal(gemIndices.length, GEM_TILES_PER_BOARD);
  for (let i = 0; i < gemIndices.length; i++) {
    for (let j = i + 1; j < gemIndices.length; j++) {
      const rowDistance = Math.abs(Math.floor(gemIndices[i] / GRID) - Math.floor(gemIndices[j] / GRID));
      const colDistance = Math.abs((gemIndices[i] % GRID) - (gemIndices[j] % GRID));
      assert.ok(Math.max(rowDistance, colDistance) > 1, 'gems must not occupy neighboring tiles');
    }
  }

  return new Set(gemIndices);
}

for (let run = 0; run < 500; run++) {
  const board = generateBoard();
  const gemSet = assertSpreadGems(board);
  const letterBoost = board.findIndex((tile) => tile.letterMult > 1);
  const wordBoost = board.findIndex((tile) => tile.wordMult > 1);
  assert.equal(gemSet.has(letterBoost), false);
  assert.equal(gemSet.has(wordBoost), false);

  for (let idx = 0; idx < 5; idx++) board[idx] = freshTile();
  spreadGems(board);
  assertSpreadGems(board);

  shuffleBoard(board);
  assertSpreadGems(board);
}

console.log(`PASS: ${GEM_TILES_PER_BOARD} spread gems across 500 generated, cascaded, and shuffled boards`);
