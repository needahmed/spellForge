# SpellForge ⚡

A multiplayer word game inspired by Discord SpellCast. Drag across a 5×5 letter grid to cast words — highest total score after 5 rounds wins.

## How to play

1. One player creates a room and shares the 4-letter code.
2. Friends join with the code (up to 6 players).
3. Each round, everyone gets the same board and 75 seconds to submit one word.
4. Drag through adjacent letters (including diagonals) — a live score badge appears when your word is valid; release to cast it. Invalid words flash red.
5. After 5 rounds, the highest total score wins.

**Scoring** (SpellCast values): A,E,I,O = 1 · N,R,S,T = 2 · D,G,L = 3 · B,H,M,P,U,Y = 4 · C,F,V,W = 5 · K = 6 · J,X = 7 · Q,Z = 8. Each board has a **DL** tile (doubles that letter) and a **2X** tile (doubles the word). Words of 6+ letters get a +10 bonus.

Dictionary: [ENABLE](https://en.wikipedia.org/wiki/Words_with_Friends#Dictionary) word list (~173k English words), validated server-side.

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

- **Client:** React + TypeScript + Vite. Pointer-event drag with an SVG glow trail, live word/score preview, red shake on invalid words.
- **Server:** Node + Express + Socket.IO. Server-authoritative: path adjacency, dictionary lookup, and scoring are all validated server-side (`server/game.ts`).
- **Shared:** scoring + path rules live in `shared/scoring.ts`, used by both sides.

## Smoke test

```sh
npx tsx scripts/mp-test.ts   # headless 2-player game against the dev server
```
