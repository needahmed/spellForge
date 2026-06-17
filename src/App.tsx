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

// ── arcane landing decor (module-level so they don't reshuffle on re-render) ──
// The letters of N-E-E-D-A-H-M-E-D-S, scattered out of order around the hero.
const FLOAT_TILES = [
  { ch: 'E', pt: 1, x: 14, y: 20, d: 0.0, dur: 7.2, rot: -8 },
  { ch: 'D', pt: 2, x: 33, y: 10, d: 1.2, dur: 8.6, rot: 6 },
  { ch: 'A', pt: 1, x: 60, y: 9, d: 1.6, dur: 8.4, rot: 4 },
  { ch: 'E', pt: 1, x: 85, y: 18, d: 0.5, dur: 9.0, rot: 11 },
  { ch: 'N', pt: 1, x: 93, y: 42, d: 2.1, dur: 7.6, rot: -12 },
  { ch: 'M', pt: 3, x: 90, y: 72, d: 0.9, dur: 8.8, rot: 9 },
  { ch: 'S', pt: 1, x: 68, y: 88, d: 2.6, dur: 7.9, rot: -6 },
  { ch: 'E', pt: 1, x: 42, y: 91, d: 0.3, dur: 9.3, rot: 12 },
  { ch: 'H', pt: 4, x: 18, y: 82, d: 1.9, dur: 8.2, rot: -10 },
  { ch: 'D', pt: 2, x: 8, y: 52, d: 0.7, dur: 9.5, rot: 7 },
];

const MOTES = Array.from({ length: 16 }, (_, i) => ({
  x: (i * 61 + 7) % 100,
  d: (i % 8) * 0.9,
  dur: 7 + (i % 6) * 1.4,
  sz: 3 + (i % 3),
}));

/** Two counter-rotating rings of arcane letters orbiting a glowing core. */
function RuneRing() {
  const outer = 'ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOP'.split('').join(' ');
  const inner = 'AEIOULNRST'.split('').join('   ');
  return (
    <div className="rune-rig" aria-hidden="true">
      <svg className="rune-ring ring-outer" viewBox="0 0 600 600">
        <defs>
          <path id="ringPathOuter" d="M300,300 m-252,0 a252,252 0 1,1 504,0 a252,252 0 1,1 -504,0" />
        </defs>
        <circle cx="300" cy="300" r="252" className="ring-stroke" />
        <circle cx="300" cy="300" r="270" className="ring-dashed" />
        <text className="ring-runes">
          <textPath href="#ringPathOuter" startOffset="0">{outer}</textPath>
        </text>
      </svg>
      <svg className="rune-ring ring-inner" viewBox="0 0 600 600">
        <defs>
          <path id="ringPathInner" d="M300,300 m-168,0 a168,168 0 1,1 336,0 a168,168 0 1,1 -336,0" />
        </defs>
        <circle cx="300" cy="300" r="168" className="ring-stroke faint" />
        <text className="ring-runes inner">
          <textPath href="#ringPathInner" startOffset="0">{inner}</textPath>
        </text>
      </svg>
      <div className="ring-core" />
    </div>
  );
}

/** A floating letter tile the player can grab and fling around the hero. */
function FloatTile({ t }: { t: (typeof FLOAT_TILES)[number] }) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const start = useRef({ px: 0, py: 0, ox: 0, oy: 0 });

  const onDown = (e: React.PointerEvent) => {
    start.current = { px: e.clientX, py: e.clientY, ox: offset.x, oy: offset.y };
    setDragging(true);
    // keep receiving moves even if the pointer slips off the tile; never let a
    // capture failure abort the drag.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* no-op */
    }
  };
  const onMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    setOffset({
      x: start.current.ox + (e.clientX - start.current.px),
      y: start.current.oy + (e.clientY - start.current.py),
    });
  };
  const onUp = (e: React.PointerEvent) => {
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* no-op */
    }
  };

  return (
    <div
      className={`float-tile${dragging ? ' dragging' : ''}`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      style={
        {
          left: `${t.x}%`,
          top: `${t.y}%`,
          '--rot': `${t.rot}deg`,
          '--dur': `${t.dur}s`,
          '--delay': `${t.d}s`,
          '--dx': `${offset.x}px`,
          '--dy': `${offset.y}px`,
        } as React.CSSProperties
      }
    >
      <div className="float-tile-inner">
        <span className="float-letter">{t.ch}</span>
        <i className="float-pts">{t.pt}</i>
      </div>
    </div>
  );
}

/** A spell-trail flourish that draws itself beneath the wordmark. */
function TitleTrail() {
  const nodes: [number, number][] = [
    [12, 28], [78, 10], [150, 26], [222, 30], [292, 12], [348, 16],
  ];
  return (
    <svg className="title-trail" viewBox="0 0 360 40" preserveAspectRatio="none" aria-hidden="true">
      <path className="trail-line" d="M12,28 C55,6 110,6 150,26 S250,38 292,12 348,16 348,16" />
      {nodes.map(([cx, cy], i) => (
        <circle
          key={i}
          className="trail-node"
          cx={cx}
          cy={cy}
          r={i === 0 || i === nodes.length - 1 ? 4.5 : 3.5}
          style={{ animationDelay: `${0.9 + i * 0.13}s` }}
        />
      ))}
    </svg>
  );
}

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
    if (name.trim().length < 2) return setError('Name must be at least 2 characters.');
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
    const trimmedName = name.trim();
    if (trimmedName.length < 2) return setError('Name must be at least 2 characters.');
    const clean = code.trim().toUpperCase();
    if (!clean) return setError('Enter a room code.');
    setBusy(true);
    socket.emit('joinRoom', clean, trimmedName, (res: { ok: boolean; error?: string }) => {
      setBusy(false);
      if (!res.ok) {
        setError(res.error ?? 'Could not join room.');
        if (invitedCode === clean) setInvitedCode('');
      }
    });
  };

  const playVsAI = () => {
    if (name.trim().length < 2) return setError('Name must be at least 2 characters.');
    setBusy(true);
    socket.emit('startPvE', name.trim(), aiDifficulty, (res: { ok: boolean; error?: string }) => {
      setBusy(false);
      if (!res.ok) return setError(res.error ?? 'Could not start game.');
      socket.emit('startGame'); // solo vs AI: skip the redundant lobby, go straight to the board
    });
  };

  // ── in a room: lobby or game ──
  if (room) {
    if (room.phase === 'lobby') return <Lobby room={room} myId={myId} error={error} onError={setError} />;
    return <Game room={room} myId={myId} />;
  }

  // ── landing ──
  if (view === 'landing') {
    return (
      <div className="screen landing arcane-screen">
        <div className="arcane-bg" aria-hidden="true">
          <div className="aura aura-gold" />
          <div className="aura aura-jade" />
          <RuneRing />
          {MOTES.map((m, i) => (
            <span
              key={i}
              className="mote"
              style={{
                left: `${m.x}%`,
                width: m.sz,
                height: m.sz,
                animationDelay: `${m.d}s`,
                animationDuration: `${m.dur}s`,
              }}
            />
          ))}
          {FLOAT_TILES.map((t, i) => (
            <FloatTile key={i} t={t} />
          ))}
        </div>

        <div className="landing-inner arcane-hero">
          <div className="hero-kicker">✦&nbsp;&nbsp;Arcane Word Duels&nbsp;&nbsp;✦</div>
          <h1 className="logo logo-hero">
            Spell<span>Casters</span>
          </h1>
          <TitleTrail />
          <p className="arcane-tagline">Connect the runes. Cast the word. Conquer the realm.</p>
          <button className="btn btn-cast" onClick={() => setView('menu')}>
            <span className="cast-rune">▶</span>
            <span className="cast-label">Play</span>
            <span className="cast-shimmer" />
          </button>
          <div className="hero-stats">
            <span>5×5 Rune Grid</span>
            <i />
            <span>Duel Friends</span>
            <i />
            <span>Cast vs AI</span>
          </div>
        </div>

        {error && <div className="toast">{error}</div>}
      </div>
    );
  }

  // ── main menu (name + 3 options) ──
  if (view === 'menu') {
    const trimmedName = name.trim();
    const nameOk = trimmedName.length >= 2;
    const nameTooShort = trimmedName.length > 0 && trimmedName.length < 2;
    return (
      <Screen onBack={() => setView('landing')} error={error}>
        {invitedCode && (
          <div className="invite-banner">
            🎉 You're invited to room <b>{invitedCode}</b>
            {!nameOk && ' — enter your name to join!'}
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
            onKeyDown={(e) => {
              if (e.key === 'Enter' && invitedCode) joinWithCode(invitedCode);
            }}
            autoFocus
          />
          {nameTooShort && (
            <p className="input-error">Name must be at least 2 characters.</p>
          )}
          {invitedCode && (
            <button
              className="btn btn-primary"
              disabled={!nameOk || busy}
              onClick={() => joinWithCode(invitedCode)}
            >
              Join Room {invitedCode}
            </button>
          )}
          <div className="menu-options">
            <button className="menu-btn" disabled={!nameOk} onClick={() => setView('createLobby')}>
              <span className="menu-btn-icon">🏰</span>
              <span className="menu-btn-text">
                <b>Create Lobby</b>
                <small>Host a game for your friends</small>
              </span>
            </button>
            <button className="menu-btn" disabled={!nameOk} onClick={() => setView('joinPublic')}>
              <span className="menu-btn-icon">🌐</span>
              <span className="menu-btn-text">
                <b>Join Public Game</b>
                <small>Hop into an open match</small>
              </span>
            </button>
            <button className="menu-btn" disabled={!nameOk} onClick={() => setView('playAI')}>
              <span className="menu-btn-icon">🤖</span>
              <span className="menu-btn-text">
                <b>Play with AI</b>
                <small>Practice solo against a bot</small>
              </span>
            </button>
          </div>
          {!nameOk && !nameTooShort && <p className="menu-hint">Enter a name (2+ chars) to continue ↑</p>}
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
        Spell<span>Casters</span>
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
        Spell<span>Casters</span>
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
                style={p.isAI ? { background: 'var(--ai)', boxShadow: '0 0 8px var(--ai)' } : {}}
              />
              <span className="player-name">{p.name}</span>
              {p.isAI && (
                <span className="host-tag" style={{ background: 'rgba(91, 224, 200, 0.18)', color: 'var(--ai)' }}>
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
