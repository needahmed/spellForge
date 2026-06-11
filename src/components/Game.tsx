import { useEffect, useRef, useState } from 'react';
import type { BoardTile } from '../../shared/scoring';
import type { RoomState, RoundResult } from '../../shared/types';
import { socket } from '../lib/socket';
import { Board } from './Board';

interface RoundData {
  round: number;
  totalRounds: number;
  tiles: BoardTile[];
  endsAt: number;
}

export function Game({ room, myId }: { room: RoomState; myId: string }) {
  const [roundData, setRoundData] = useState<RoundData | null>(null);
  const [roundResults, setRoundResults] = useState<RoundResult[] | null>(null);
  const [standings, setStandings] = useState<RoundResult[] | null>(null);
  const [myWord, setMyWord] = useState<{ word: string; points: number } | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const onRoundStart = (data: RoundData) => {
      setRoundData(data);
      setRoundResults(null);
      setStandings(null);
      setMyWord(null);
    };
    const onRoundEnd = (data: { round: number; results: RoundResult[] }) => {
      setRoundResults(data.results);
    };
    const onGameEnd = (data: { standings: RoundResult[] }) => {
      setStandings(data.standings);
      setRoundResults(null);
    };
    socket.on('roundStart', onRoundStart);
    socket.on('roundEnd', onRoundEnd);
    socket.on('gameEnd', onGameEnd);
    return () => {
      socket.off('roundStart', onRoundStart);
      socket.off('roundEnd', onRoundEnd);
      socket.off('gameEnd', onGameEnd);
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const me = room.players.find((p) => p.id === myId);
  const submitted = !!me?.submitted;
  const isHost = room.hostId === myId;

  const submitWord = (path: number[]) =>
    new Promise<{ ok: boolean; error?: string }>((resolve) => {
      const word = roundData ? path.map((i) => roundData.tiles[i].letter).join('') : '';
      socket.emit('submitWord', path, (res: { ok: boolean; points?: number; error?: string }) => {
        if (res.ok && res.points !== undefined) setMyWord({ word, points: res.points });
        resolve(res);
      });
    });

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
                <span className="standing-name">{s.name}</span>
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

  if (!roundData) {
    return (
      <div className="screen">
        <p className="waiting-text">Summoning the board…</p>
      </div>
    );
  }

  const secsLeft = Math.max(0, Math.ceil((roundData.endsAt - now) / 1000));
  const totalSecs = 75;
  const timeFrac = Math.max(0, Math.min(1, (roundData.endsAt - now) / (totalSecs * 1000)));
  const sortedPlayers = [...room.players].sort((a, b) => b.score - a.score);

  return (
    <div className="screen game">
      <header className="game-header">
        <div className="round-pill">
          Round {roundData.round}<span>/{roundData.totalRounds}</span>
        </div>
        <div className="timer">
          <div className="timer-bar">
            <div
              className={`timer-fill ${secsLeft <= 10 ? 'timer-low' : ''}`}
              style={{ width: `${timeFrac * 100}%` }}
            />
          </div>
          <span className={`timer-secs ${secsLeft <= 10 ? 'timer-low-text' : ''}`}>{secsLeft}s</span>
        </div>
      </header>

      <div className="game-body">
        <div className="board-wrap">
          <Board tiles={roundData.tiles} disabled={submitted || room.phase !== 'playing'} onSubmit={submitWord} />
          {submitted && room.phase === 'playing' && (
            <div className="submitted-overlay">
              <div className="submitted-card">
                {myWord && (
                  <>
                    <div className="submitted-word">{myWord.word}</div>
                    <div className="submitted-points">+{myWord.points} points</div>
                  </>
                )}
                <div className="submitted-waiting">
                  Waiting for{' '}
                  {room.players
                    .filter((p) => !p.submitted)
                    .map((p) => p.name)
                    .join(', ') || '…'}
                </div>
              </div>
            </div>
          )}
        </div>

        <aside className="scoreboard">
          <h3>Spellcasters</h3>
          {sortedPlayers.map((p) => (
            <div className={`score-row ${p.id === myId ? 'is-me' : ''}`} key={p.id}>
              <span className={`status-dot ${p.submitted ? 'done' : ''}`} />
              <span className="score-name">{p.name}</span>
              <span className="score-value">{p.score}</span>
            </div>
          ))}
        </aside>
      </div>

      {roundResults && (
        <div className="modal-backdrop">
          <div className="card results-card">
            <h2>Round {roundData.round} results</h2>
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
              {roundData.round >= roundData.totalRounds ? 'Final scores incoming…' : 'Next round starting…'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
