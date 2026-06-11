import { useEffect, useState } from 'react';
import type { BoardTile } from '../../shared/scoring';
import type { RoomState, RoundResult } from '../../shared/types';
import { socket } from '../lib/socket';
import { Board } from './Board';

const TURN_SECONDS = 45;

interface LastPlay {
  playerId: string;
  name: string;
  word: string;
  points: number;
  gemsCollected: number;
  ts: number;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export function Game({ room, myId }: { room: RoomState; myId: string }) {
  // initialized from roomState so a freshly-mounted Game never misses the board
  const [tiles, setTiles] = useState<BoardTile[] | null>(room.tiles.length ? room.tiles : null);
  const [round, setRound] = useState(room.round);
  const [dropIn, setDropIn] = useState<{ ids: number[]; ts: number } | null>(null);
  const [remotePath, setRemotePath] = useState<number[]>([]);
  const [lastPlay, setLastPlay] = useState<LastPlay | null>(null);
  const [hintPath, setHintPath] = useState<number[] | null>(null);
  const [swapPicking, setSwapPicking] = useState(false);
  const [swapIdx, setSwapIdx] = useState<number | null>(null);
  const [roundResults, setRoundResults] = useState<RoundResult[] | null>(null);
  const [standings, setStandings] = useState<RoundResult[] | null>(null);
  const [toast, setToast] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const onRoundStart = (data: { round: number; tiles: BoardTile[] }) => {
      setTiles(data.tiles);
      setRound(data.round);
      setRoundResults(null);
      setStandings(null);
      setLastPlay(null);
      setHintPath(null);
      setRemotePath([]);
      setSwapPicking(false);
      setSwapIdx(null);
    };
    const onWordPlayed = (data: Omit<LastPlay, 'ts'>) => {
      setLastPlay({ ...data, ts: Date.now() });
      setRemotePath([]);
    };
    const onBoardUpdate = (data: { tiles: BoardTile[]; replaced: number[]; cause: string }) => {
      setTiles(data.tiles);
      setDropIn({ ids: data.replaced, ts: Date.now() });
      if (data.cause !== 'swap') setHintPath(null);
      setRemotePath([]);
    };
    const onRemoteDrag = (data: { playerId: string; path: number[] }) => setRemotePath(data.path);
    const onRoundEnd = (data: { results: RoundResult[] }) => {
      setRoundResults(data.results);
    };
    const onGameEnd = (data: { standings: RoundResult[] }) => {
      setStandings(data.standings);
      setRoundResults(null);
    };
    socket.on('roundStart', onRoundStart);
    socket.on('wordPlayed', onWordPlayed);
    socket.on('boardUpdate', onBoardUpdate);
    socket.on('remoteDrag', onRemoteDrag);
    socket.on('roundEnd', onRoundEnd);
    socket.on('gameEnd', onGameEnd);
    return () => {
      socket.off('roundStart', onRoundStart);
      socket.off('wordPlayed', onWordPlayed);
      socket.off('boardUpdate', onBoardUpdate);
      socket.off('remoteDrag', onRemoteDrag);
      socket.off('roundEnd', onRoundEnd);
      socket.off('gameEnd', onGameEnd);
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (lastPlay) {
      const t = setTimeout(() => setLastPlay(null), 2600);
      return () => clearTimeout(t);
    }
  }, [lastPlay?.ts]);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(''), 3000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  // clear the spectator trail whenever the turn changes hands
  useEffect(() => {
    setRemotePath([]);
  }, [room.activePlayerId]);

  const me = room.players.find((p) => p.id === myId);
  const myGems = me?.gems ?? 0;
  const isHost = room.hostId === myId;
  const activePlayer = room.players.find((p) => p.id === room.activePlayerId);
  const isMyTurn = room.phase === 'playing' && room.activePlayerId === myId && !(me?.played);

  const submitWord = (path: number[]) =>
    new Promise<{ ok: boolean; error?: string }>((resolve) => {
      socket.emit('submitWord', path, (res: { ok: boolean; error?: string }) => {
        if (!res.ok && res.error) setToast(res.error);
        resolve(res);
      });
    });

  const ability = (event: string, ...args: unknown[]) => {
    socket.emit(event, ...args, (res: { ok: boolean; error?: string; path?: number[] }) => {
      if (!res.ok) {
        setToast(res.error ?? 'Nope.');
        return;
      }
      if (event === 'useHint' && res.path) {
        setHintPath(res.path);
        setTimeout(() => setHintPath(null), 6000);
      }
    });
  };

  const startSwap = () => {
    if (!isMyTurn || myGems < 3) return;
    setSwapPicking(true);
  };

  const pickSwapTile = (idx: number) => {
    setSwapIdx(idx);
    setSwapPicking(false);
  };

  const chooseSwapLetter = (letter: string) => {
    if (swapIdx !== null) ability('useSwap', swapIdx, letter);
    setSwapIdx(null);
  };

  // ---------- final standings ----------
  if (standings) {
    const winner = standings[0];
    return (
      <div className="screen game-over">
        <h1 className="logo logo-small">
          Spell<span>Forge</span>
        </h1>
        <div className="card">
          <div className="winner-crown">👑</div>
          <h2 className="winner-name">{winner.name} wins!</h2>
          <div className="standings">
            {standings.map((s, i) => (
              <div className={`standing-row ${s.playerId === myId ? 'is-me' : ''}`} key={s.playerId}>
                <span className="standing-rank">#{i + 1}</span>
                <span className="standing-name">
                  {s.name}
                  {!!s.gemBonus && <span className="gem-bonus">+{s.gemBonus} ♦</span>}
                </span>
                <span className="standing-score">{s.total}</span>
              </div>
            ))}
          </div>
          {isHost ? (
            <button className="btn btn-primary" onClick={() => socket.emit('playAgain')}>
              Back to Lobby
            </button>
          ) : (
            <p className="waiting-text">Waiting for the host…</p>
          )}
        </div>
      </div>
    );
  }

  if (!tiles) {
    return (
      <div className="screen">
        <p className="waiting-text">Summoning the board…</p>
      </div>
    );
  }

  const turnActive = room.phase === 'playing' && !!room.activePlayerId;
  const secsLeft = turnActive ? Math.max(0, Math.ceil((room.turnEndsAt - now) / 1000)) : 0;
  const timeFrac = turnActive ? Math.max(0, Math.min(1, (room.turnEndsAt - now) / (TURN_SECONDS * 1000))) : 0;
  const sortedPlayers = [...room.players].sort((a, b) => b.score - a.score);
  const hintWord = hintPath ? hintPath.map((i) => tiles[i].letter).join('') : null;

  return (
    <div className="screen game">
      <header className="game-header">
        <div className="round-pill">
          Round {round}<span>/{room.totalRounds}</span>
        </div>
        <div className="timer">
          <div className="timer-bar">
            <div
              className={`timer-fill ${secsLeft <= 10 ? 'timer-low' : ''}`}
              style={{ width: `${timeFrac * 100}%` }}
            />
          </div>
          <span className={`timer-secs ${secsLeft <= 10 && secsLeft > 0 ? 'timer-low-text' : ''}`}>{secsLeft}s</span>
        </div>
      </header>

      <div className={`turn-banner ${isMyTurn ? 'my-turn' : ''}`}>
        {room.phase !== 'playing'
          ? 'Round over!'
          : isMyTurn
            ? '✨ Your turn — cast a word!'
            : activePlayer
              ? `${activePlayer.name} is casting…`
              : '…'}
      </div>

      <div className="game-body">
        <div className="board-wrap">
          <Board
            tiles={tiles}
            disabled={!isMyTurn}
            onSubmit={submitWord}
            onPathChange={(p) => isMyTurn && socket.emit('dragPath', p)}
            remotePath={remotePath}
            dropIn={dropIn}
            hintPath={hintPath}
            pickMode={swapPicking}
            onPickTile={pickSwapTile}
          />
          {swapPicking && <div className="pick-hint">Tap the tile you want to transform ✨</div>}
          {hintWord && (
            <div className="hint-banner">
              Hint: <b>{hintWord}</b>
            </div>
          )}
          {lastPlay && (
            <div className="play-banner" key={lastPlay.ts}>
              <span className="play-name">{lastPlay.playerId === myId ? 'You' : lastPlay.name}</span> cast{' '}
              <span className="play-word">{lastPlay.word}</span>
              <span className="play-points">+{lastPlay.points}</span>
              {lastPlay.gemsCollected > 0 && <span className="play-gems">♦ +{lastPlay.gemsCollected}</span>}
            </div>
          )}
        </div>

        <aside className="side-col">
          <div className="scoreboard">
            <h3>Spellcasters</h3>
            {sortedPlayers.map((p) => (
              <div
                className={`score-row ${p.id === myId ? 'is-me' : ''} ${p.id === room.activePlayerId ? 'is-active' : ''}`}
                key={p.id}
              >
                <span className={`status-dot ${p.played ? 'done' : ''} ${p.id === room.activePlayerId ? 'turn' : ''}`} />
                <span className="score-name">{p.name}</span>
                <span className="score-gems">♦ {p.gems}</span>
                <span className="score-value">{p.score}</span>
              </div>
            ))}
          </div>

          <div className="abilities">
            <h3>
              Abilities <span className="my-gems">♦ {myGems}</span>
            </h3>
            <button
              className="ability-btn"
              disabled={!isMyTurn || myGems < 1}
              onClick={() => ability('useShuffle')}
              title="Rearrange all letters — bonuses stay attached"
            >
              🔀 Shuffle <span className="ability-cost">♦1</span>
            </button>
            <button
              className="ability-btn"
              disabled={!isMyTurn || myGems < 3}
              onClick={startSwap}
              title="Replace any letter on the board with one you choose"
            >
              🔁 Swap <span className="ability-cost">♦3</span>
            </button>
            <button
              className="ability-btn"
              disabled={!isMyTurn || myGems < 4}
              onClick={() => ability('useHint')}
              title="Reveal a valid word on the board"
            >
              💡 Hint <span className="ability-cost">♦4</span>
            </button>
            <button
              className="ability-btn"
              disabled={!isMyTurn || myGems < 1}
              onClick={() => ability('useTimeExtend')}
              title="Add 30 seconds to your turn"
            >
              ⏳ +30s <span className="ability-cost">♦1</span>
            </button>
            {isMyTurn && (
              <button className="btn-ghost pass-btn" onClick={() => socket.emit('passTurn')}>
                Pass turn
              </button>
            )}
          </div>
        </aside>
      </div>

      {swapIdx !== null && tiles && (
        <div className="modal-backdrop" onClick={() => setSwapIdx(null)}>
          <div className="card letter-picker" onClick={(e) => e.stopPropagation()}>
            <h2>
              Transform <span className="swap-from">{tiles[swapIdx].letter}</span> into…
            </h2>
            <div className="letter-grid">
              {ALPHABET.map((l) => (
                <button key={l} className="letter-btn" onClick={() => chooseSwapLetter(l)}>
                  {l}
                </button>
              ))}
            </div>
            <button className="btn btn-ghost" onClick={() => setSwapIdx(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {roundResults && (
        <div className="modal-backdrop">
          <div className="card results-card">
            <h2>Round {round} results</h2>
            <div className="results-list">
              {roundResults.map((r) => (
                <div className={`result-row ${r.playerId === myId ? 'is-me' : ''}`} key={r.playerId}>
                  <span className="result-name">{r.name}</span>
                  <span className="result-word">{r.word}</span>
                  <span className="result-points">+{r.points}</span>
                  <span className="result-total">{r.total}</span>
                </div>
              ))}
            </div>
            <p className="waiting-text">
              {round >= room.totalRounds ? 'Final scores incoming…' : 'New board incoming…'}
            </p>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
