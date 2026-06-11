# SpellForge ⚡

A turn-based multiplayer word game inspired by Discord SpellCast. Drag across a 5×5 letter grid to cast words — highest total score after 5 rounds wins.

## How to play

1. One player creates a room and shares the 4-letter code.
2. Friends join with the code (up to 6 players).
3. **Players take turns** (45 seconds each). On your turn, drag through adjacent letters (including diagonals) — a live score badge appears when your word is valid; release to cast it. Invalid words flash red. Everyone else watches your drag live.
4. After your word, the used tiles drop away and fresh ones fall in for the next player.
5. When everyone has had a turn, the round ends and a **brand-new board** appears (new DL/2X/gems).
6. After 5 rounds, the highest total wins. Leftover gems are worth **1 point each**.

**Scoring** (SpellCast values): A,E,I,O = 1 · N,R,S,T = 2 · D,G,L = 3 · B,H,M,P,U,Y = 4 · C,F,V,W = 5 · K = 6 · J,X = 7 · Q,Z = 8. Each board has a **DL** tile (doubles that letter) and a **2X** tile (doubles the word). Words of 6+ letters get a +10 bonus.

### Gems ♦

Everyone starts with **3 gems** (max 10). Pink gem tiles appear on the board — cast a word through them to collect. Spend them on your turn:

| Ability | Cost | Effect |
|---|---|---|
| 🔀 Shuffle | ♦1 | Rearranges all letters — bonuses and gems stay attached |
| 🔁 Swap | ♦3 | Replace any letter on the board with one you choose |
| 💡 Hint | ♦4 | Reveals a valid word on the board |
| ⏳ +30s | ♦1 | Extends your turn timer |

Unspent gems convert to 1 point each at game end — spend or save!

Dictionary: ENABLE word list (~173k English words), validated server-side.

## Run it

```sh
npm install
npm run dev        # dev: client on http://localhost:5173, socket server on :3001
```

Production (single server serving everything):

```sh
npm run build
npm start          # http://localhost:3001 (set PORT to override)
```

## Playing with friends

The server must be reachable by everyone:

- **Same network (LAN):** run `npm run build && npm start`, friends open `http://<your-LAN-IP>:3001`.
- **Over the internet:** easiest is a tunnel — `cloudflared tunnel --url http://localhost:3001` or `ngrok http 3001` — and share the URL. Or deploy to any Node host (Railway, Render, Fly.io, a VPS): `npm run build`, then `npm start` with `PORT` set.

## Stack

- **Client:** React + TypeScript + Vite. Pointer-event drag with an SVG glow trail, live word/score preview, red shake on invalid words, tile drop-in cascades, live spectator trail of the active player's drag.
- **Server:** Node + Express + Socket.IO. Server-authoritative: turn order, path adjacency, dictionary lookup, scoring, gem economy, and ability costs are all validated server-side (`server/game.ts`). Hints come from a randomized DFS with a prefix index (`server/dictionary.ts`).
- **Shared:** scoring + path rules live in `shared/scoring.ts`, used by both sides.

## Smoke tests

```sh
npx tsx scripts/mp-test.ts        # headless 2-player game: turns, gems, abilities, cascade
npx tsx scripts/spectate-test.ts  # headless player that drags slowly (join it from a browser to watch)
```
