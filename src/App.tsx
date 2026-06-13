import { useEffect, useRef, useState } from 'react';
import type { AiDifficulty, PublicRoom, RoomState } from '../shared/types';
import { socket } from './lib/socket';
import { loadDictionary } from './lib/dictionary';
import { Game } from './components/Game';

type View = 'landing' | 'menu' | 'createLobby' | 'joinPublic' | 'playAI';

/** Pull a ?join=CODE (or #CODE) invite param, then strip it from the URL. */
function readInviteCode(): string {
  const params = new URLSearchParams(window.location.search);
  let code = params.get('join') ?? '';
  if (!code && window.location.hash.startsWith('#')) code = window.location.hash.slice(1);
  code = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  if (code) window.history.replaceState(null, '', window.location.pathname);
  return code;
}

const DIFFICULTIES: { id: AiDifficulty; label: string; desc: string; icon: string }[] = [
  { id: 'easy', label: 'Easy', desc: 'Short words, sometimes passes', icon: '🌱' },
  { id: 'medium', label: 'Medium', desc: 'Solid 4–6 letter words', icon: '⚔️' },
  { id: 'hard', label: 'Hard', desc: 'Hunts for the longest words', icon: '🔥' },
];

export default function App() {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [myId, setMyId] = useState<string>(socket.id ?? '');
  const [error, setError] = useState('');
  const [name, setName] = useState(() => localStorage.getItem('sf-name') ?? '');
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [aiDifficulty, setAiDifficulty] = useState<AiDifficulty>('medium');
  const [invitedCode, setInvitedCode] = useState('');
  const [publicRooms, setPublicRooms] = useState<PublicRoom[]>([]);
  const [view, setView] = useState<View>('landing');
  const autoJoinedRef = useRef(false);

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

  // Read an invite link once on first load → jump to the menu (auto-joins if a name is saved).
  useEffect(() => {
    const code = readInviteCode();
    if (code) {
      setInvitedCode(code);
      setJoinCode(code);
      setView('menu');
    }
  }, []);

  // Subscribe to the live public-lobby list only while browsing it.
  useEffect(() => {
    if (room || view !== 'joinPublic') return;
    const onPublic = (list: PublicRoom[]) => setPublicRooms(list);
    const subscribe = () =>
      socket.emit('subscribeLobbies', (res: { ok: boolean; rooms?: PublicRoom[] }) => {
        if (res.ok && res.rooms) setPublicRooms(res.rooms);
      });
    socket.on('publicRooms', onPublic);
    if (socket.connected) subscribe();
    socket.on('connect', subscribe);
    return () => {
      socket.off('publicRooms', onPublic);
      socket.off('connect', subscribe);
      socket.emit('unsubscribeLobbies');
    };
  }, [room, view]);

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

  const createLobby = (isPublic: boolean) => {
    if (!name.trim()) return setError('Pick a wizard name first!');
    setBusy(true);
    socket.emit('createRoom', name.trim(), (res: { ok: boolean; error?: string }) => {
      if (!res.ok) {
        setBusy(false);
        return setError(res.error ?? 'Could not create room.');
      }
      if (isPublic) socket.emit('setVisibility', true, () => setBusy(false));
      else setBusy(false);
      // roomState will arrive and render the Lobby
    });
  };

  const joinWithCode = (code: string) => {
    if (!name.trim()) return setError('Pick a wizard name first!');
    const clean = code.trim().toUpperCase();
    if (!clean) return setError('Enter a room code.');
    setBusy(true);
    socket.emit('joinRoom', clean, name.trim(), (res: { ok: boolean; error?: string }) => {
      setBusy(false);
      if (!res.ok) {
        setError(res.error ?? 'Could not join room.');
        if (invitedCode === clean) setInvitedCode('');
      }
    });
  };

  const playVsAI = () => {
    if (!name.trim()) return setError('Pick a wizard name first!');
    setBusy(true);
    socket.emit('startPvE', name.trim(), aiDifficulty, (res: { ok: boolean; error?: string }) => {
      setBusy(false);
      if (!res.ok) return setError(res.error ?? 'Could not start game.');
      socket.emit('startGame'); // solo vs AI: skip the redundant lobby, go straight to the board
    });
  };

  // Auto-join from an invite link once we have a name and a live connection.
  useEffect(() => {
    if (invitedCode && name.trim() && !room && !busy && !autoJoinedRef.current) {
      autoJoinedRef.current = true;
      joinWithCode(invitedCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invitedCode, name, room, busy]);

  // ── in a room: lobby or game ──
  if (room) {
    if (room.phase === 'lobby') return <Lobby room={room} myId={myId} error={error} onError={setError} />;
    return <Game room={room} myId={myId} />;
  }

  // ── landing ──
  if (view === 'landing') {
    return (
      <div className="screen landing">
        <div className="landing-inner">
          <h1 className="logo logo-xl">
            Spell<span>Forge</span>
          </h1>
          <p className="tagline">Connect letters. Cast words. Crush your friends.</p>
          <button className="btn btn-primary btn-play" onClick={() => setView('menu')}>
            ▶ Play
          </button>
        </div>
        {error && <div className="toast">{error}</div>}
      </div>
    );
  }

  // ── main menu (name + 3 options) ──
  if (view === 'menu') {
    const ready = !!name.trim();
    return (
      <Screen onBack={() => setView('landing')} error={error}>
        {invitedCode && (
          <div className="invite-banner">
            🎉 You're invited to room <b>{invitedCode}</b>
            {!ready && ' — enter your name to join!'}
          </div>
        )}
        <div className="card">
          <label className="field-label">Your name</label>
          <input
            className="input"
            maxLength={16}
            placeholder="WizardLizard"
            value={name}
            onChange={(e) => saveName(e.target.value)}
            autoFocus
          />
          <div className="menu-options">
            <button className="menu-btn" disabled={!ready} onClick={() => setView('createLobby')}>
              <span className="menu-btn-icon">🏰</span>
              <span className="menu-btn-text">
                <b>Create Lobby</b>
                <small>Host a game for your friends</small>
              </span>
            </button>
            <button className="menu-btn" disabled={!ready} onClick={() => setView('joinPublic')}>
              <span className="menu-btn-icon">🌐</span>
              <span className="menu-btn-text">
                <b>Join Public Game</b>
                <small>Hop into an open match</small>
              </span>
            </button>
            <button className="menu-btn" disabled={!ready} onClick={() => setView('playAI')}>
              <span className="menu-btn-icon">🤖</span>
              <span className="menu-btn-text">
                <b>Play with AI</b>
                <small>Practice solo against a bot</small>
              </span>
            </button>
          </div>
          {!ready && <p className="menu-hint">Enter a name to continue ↑</p>}
        </div>
      </Screen>
    );
  }

  // ── create lobby: public or private ──
  if (view === 'createLobby') {
    return (
      <Screen onBack={() => setView('menu')} error={error}>
        <div className="card">
          <label className="field-label">Create a lobby</label>
          <div className="menu-options">
            <button className="menu-btn" disabled={busy} onClick={() => createLobby(true)}>
              <span className="menu-btn-icon">🌐</span>
              <span className="menu-btn-text">
                <b>Public Lobby</b>
                <small>Anyone can find and join from the public list</small>
              </span>
            </button>
            <button className="menu-btn" disabled={busy} onClick={() => createLobby(false)}>
              <span className="menu-btn-icon">🔒</span>
              <span className="menu-btn-text">
                <b>Private Lobby</b>
                <small>Invite-only — share the code or link</small>
              </span>
            </button>
          </div>
        </div>
      </Screen>
    );
  }

  // ── join public game (live list + code fallback) ──
  if (view === 'joinPublic') {
    return (
      <Screen onBack={() => setView('menu')} error={error}>
        <div className="card lobby-browser">
          <div className="lobby-browser-head">
            <label className="field-label">🌐 Public games</label>
            <span className="lobby-count">{publicRooms.length} open</span>
          </div>
          {publicRooms.length === 0 ? (
            <p className="lobby-empty">No public games right now — create one and make it public!</p>
          ) : (
            <div className="lobby-list">
              {publicRooms.map((r) => (
                <div className="lobby-item" key={r.code}>
                  <div className="lobby-info">
                    <span className="lobby-host">{r.hostName}'s game</span>
                    <span className="lobby-meta">
                      <span className="lobby-code">{r.code}</span> · {r.playerCount}/{r.maxPlayers} players
                    </span>
                  </div>
                  <button
                    className="btn btn-secondary lobby-join"
                    disabled={busy}
                    onClick={() => joinWithCode(r.code)}
                  >
                    Join
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card join-code-card">
          <label className="field-label">Have a room code?</label>
          <div className="join-row">
            <input
              className="input input-code"
              maxLength={4}
              placeholder="CODE"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && joinWithCode(joinCode)}
            />
            <button className="btn btn-secondary" disabled={busy} onClick={() => joinWithCode(joinCode)}>
              Join
            </button>
          </div>
        </div>
      </Screen>
    );
  }

  // ── play with AI: pick difficulty ──
  return (
    <Screen onBack={() => setView('menu')} error={error}>
      <div className="card">
        <label className="field-label">Choose difficulty</label>
        <div className="diff-cards">
          {DIFFICULTIES.map((d) => (
            <button
              key={d.id}
              className={`diff-card ${aiDifficulty === d.id ? 'active' : ''}`}
              onClick={() => setAiDifficulty(d.id)}
            >
              <span className="diff-icon">{d.icon}</span>
              <b>{d.label}</b>
              <small>{d.desc}</small>
            </button>
          ))}
        </div>
        <button className="btn btn-primary" disabled={busy} onClick={playVsAI}>
          Start Game
        </button>
      </div>
    </Screen>
  );
}

/** Shared chrome for the menu sub-screens: logo, a back button, and a toast slot. */
function Screen({
  children,
  onBack,
  error,
}: {
  children: React.ReactNode;
  onBack: () => void;
  error: string;
}) {
  return (
    <div className="screen menu-screen">
      <h1 className="logo logo-small">
        Spell<span>Forge</span>
      </h1>
      {children}
      <button className="btn btn-ghost back-link" onClick={onBack}>
        ← Back
      </button>
      {error && <div className="toast">{error}</div>}
    </div>
  );
}

function Lobby({
  room,
  myId,
  error,
  onError,
}: {
  room: RoomState;
  myId: string;
  error: string;
  onError: (e: string) => void;
}) {
  const isHost = room.hostId === myId;
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);

  const inviteLink = `${window.location.origin}/?join=${room.code}`;

  const copy = (text: string, which: 'code' | 'link') => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const setVisibility = (isPublic: boolean) => {
    socket.emit('setVisibility', isPublic, (res: { ok: boolean; error?: string }) => {
      if (!res.ok) onError(res.error ?? 'Could not change visibility.');
    });
  };

  return (
    <div className="screen home">
      <h1 className="logo logo-small">
        Spell<span>Forge</span>
      </h1>
      <div className="card">
        <label className="field-label">Room code — share with friends</label>
        <button className="room-code" onClick={() => copy(room.code, 'code')} title="Click to copy">
          {room.code}
          <span className="copy-hint">{copied === 'code' ? 'copied!' : 'copy'}</span>
        </button>

        <button className="btn btn-invite" onClick={() => copy(inviteLink, 'link')}>
          {copied === 'link' ? '✓ Link copied!' : '🔗 Copy invite link'}
        </button>

        {isHost ? (
          <div className="visibility-toggle">
            <button className={`vis-btn ${room.isPublic ? 'active' : ''}`} onClick={() => setVisibility(true)}>
              🌐 Public
            </button>
            <button className={`vis-btn ${!room.isPublic ? 'active' : ''}`} onClick={() => setVisibility(false)}>
              🔒 Private
            </button>
          </div>
        ) : (
          <p className="visibility-status">{room.isPublic ? '🌐 Public game' : '🔒 Private game'}</p>
        )}

        <div className="player-list">
          {room.players.map((p) => (
            <div className="player-row" key={p.id}>
              <span
                className="player-dot"
                style={p.isAI ? { background: '#9d6fff', boxShadow: '0 0 8px #9d6fff' } : {}}
              />
              <span className="player-name">{p.name}</span>
              {p.isAI && (
                <span className="host-tag" style={{ background: 'rgba(157,111,255,0.18)', color: '#9d6fff' }}>
                  AI
                </span>
              )}
              {!p.isAI && p.id === room.hostId && <span className="host-tag">host</span>}
              {p.id === myId && <span className="you-tag">you</span>}
            </div>
          ))}
        </div>
        {isHost ? (
          <button className="btn btn-primary" onClick={() => socket.emit('startGame')}>
            Start Game ({room.players.length} player{room.players.length > 1 ? 's' : ''})
          </button>
        ) : (
          <p className="waiting-text">Waiting for the host to start…</p>
        )}
        <button
          className="btn btn-ghost"
          onClick={() => {
            socket.emit('leaveRoom');
            location.reload();
          }}
        >
          Leave room
        </button>
      </div>
      {error && <div className="toast">{error}</div>}
    </div>
  );
}
