import { useEffect, useState } from 'react';
import type { AiDifficulty, RoomState } from '../shared/types';
import { socket } from './lib/socket';
import { loadDictionary } from './lib/dictionary';
import { Game } from './components/Game';

export default function App() {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [myId, setMyId] = useState<string>(socket.id ?? '');
  const [error, setError] = useState('');
  const [name, setName] = useState(() => localStorage.getItem('sf-name') ?? '');
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [aiDifficulty, setAiDifficulty] = useState<AiDifficulty>('medium');

  useEffect(() => {
    loadDictionary();
    const onConnect = () => setMyId(socket.id ?? '');
    const onRoomState = (state: RoomState) => setRoom(state);
    const onDisconnect = () => {
      setRoom(null);
      setError('Connection lost — rejoin with your room code.');
    };
    socket.on('connect', onConnect);
    socket.on('roomState', onRoomState);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('connect', onConnect);
      socket.off('roomState', onRoomState);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(''), 4000);
      return () => clearTimeout(t);
    }
  }, [error]);

  const saveName = (n: string) => {
    setName(n);
    localStorage.setItem('sf-name', n);
  };

  const createRoom = () => {
    if (!name.trim()) return setError('Pick a wizard name first!');
    setBusy(true);
    socket.emit('createRoom', name.trim(), (res: { ok: boolean; error?: string }) => {
      setBusy(false);
      if (!res.ok) setError(res.error ?? 'Could not create room.');
    });
  };

  const joinRoom = () => {
    if (!name.trim()) return setError('Pick a wizard name first!');
    if (!joinCode.trim()) return setError('Enter a room code.');
    setBusy(true);
    socket.emit('joinRoom', joinCode.trim().toUpperCase(), name.trim(), (res: { ok: boolean; error?: string }) => {
      setBusy(false);
      if (!res.ok) setError(res.error ?? 'Could not join room.');
    });
  };

  const playVsAI = () => {
    if (!name.trim()) return setError('Pick a wizard name first!');
    setBusy(true);
    socket.emit('startPvE', name.trim(), aiDifficulty, (res: { ok: boolean; error?: string }) => {
      setBusy(false);
      if (!res.ok) setError(res.error ?? 'Could not start game.');
    });
  };

  if (!room) {
    return (
      <div className="screen home">
        <h1 className="logo">
          Spell<span>Forge</span>
        </h1>
        <p className="tagline">Connect letters. Cast words. Crush your friends.</p>
        <div className="card">
          <label className="field-label">Your name</label>
          <input
            className="input"
            maxLength={16}
            placeholder="WizardLizard"
            value={name}
            onChange={(e) => saveName(e.target.value)}
          />
          <button className="btn btn-primary" disabled={busy} onClick={createRoom}>
            Create Room
          </button>
          <div className="divider">or solo</div>
          <div className="pve-row">
            <select
              className="input difficulty-select"
              value={aiDifficulty}
              onChange={(e) => setAiDifficulty(e.target.value as AiDifficulty)}
            >
              <option value="easy">Easy AI</option>
              <option value="medium">Medium AI</option>
              <option value="hard">Hard AI</option>
            </select>
            <button className="btn btn-secondary" disabled={busy} onClick={playVsAI}>
              Play vs AI
            </button>
          </div>
          <div className="divider">or join a friend</div>
          <div className="join-row">
            <input
              className="input input-code"
              maxLength={4}
              placeholder="CODE"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && joinRoom()}
            />
            <button className="btn btn-secondary" disabled={busy} onClick={joinRoom}>
              Join
            </button>
          </div>
        </div>
        {error && <div className="toast">{error}</div>}
      </div>
    );
  }

  if (room.phase === 'lobby') {
    return <Lobby room={room} myId={myId} onError={setError} error={error} />;
  }

  return <Game room={room} myId={myId} />;
}

function Lobby({
  room,
  myId,
  onError,
  error,
}: {
  room: RoomState;
  myId: string;
  onError: (e: string) => void;
  error: string;
}) {
  const isHost = room.hostId === myId;
  const [copied, setCopied] = useState(false);

  const copyCode = () => {
    navigator.clipboard?.writeText(room.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="screen home">
      <h1 className="logo logo-small">
        Spell<span>Forge</span>
      </h1>
      <div className="card">
        <label className="field-label">Room code — share with friends</label>
        <button className="room-code" onClick={copyCode} title="Click to copy">
          {room.code}
          <span className="copy-hint">{copied ? 'copied!' : 'copy'}</span>
        </button>
        <div className="player-list">
          {room.players.map((p) => (
            <div className="player-row" key={p.id}>
              <span className="player-dot" style={p.isAI ? { background: '#9d6fff', boxShadow: '0 0 8px #9d6fff' } : {}} />
              <span className="player-name">{p.name}</span>
              {p.isAI && <span className="host-tag" style={{ background: 'rgba(157,111,255,0.18)', color: '#9d6fff' }}>AI</span>}
              {!p.isAI && p.id === room.hostId && <span className="host-tag">host</span>}
              {p.id === myId && <span className="you-tag">you</span>}
            </div>
          ))}
        </div>
        {isHost ? (
          <button
            className="btn btn-primary"
            onClick={() => socket.emit('startGame')}
          >
            Start Game ({room.players.length} player{room.players.length > 1 ? 's' : ''})
          </button>
        ) : (
          <p className="waiting-text">Waiting for the host to start…</p>
        )}
        <button className="btn btn-ghost" onClick={() => { socket.emit('leaveRoom'); location.reload(); }}>
          Leave room
        </button>
      </div>
      {error && <div className="toast">{error}</div>}
    </div>
  );
}
