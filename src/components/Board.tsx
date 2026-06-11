import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoardTile } from '../../shared/scoring';
import { GRID, LETTER_VALUES, MIN_WORD_LEN, isAdjacent, pathToWord, scoreWord } from '../../shared/scoring';
import { getWords, loadDictionary } from '../lib/dictionary';

interface BoardProps {
  tiles: BoardTile[];
  disabled: boolean;
  onSubmit: (path: number[]) => Promise<{ ok: boolean; error?: string }>;
}

interface Pt {
  x: number;
  y: number;
}

export function Board({ tiles, disabled, onSubmit }: BoardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tileRefs = useRef<(HTMLDivElement | null)[]>([]);
  const centersRef = useRef<Pt[]>([]);
  const tileSizeRef = useRef(0);
  const draggingRef = useRef(false);

  const [path, setPath] = useState<number[]>([]);
  // Source of truth during a drag — state lags behind events by a render,
  // so pointerup must read this, not the rendered path.
  const pathLiveRef = useRef<number[]>([]);
  const updatePath = (next: number[]) => {
    pathLiveRef.current = next;
    setPath(next);
  };
  const [pointer, setPointer] = useState<Pt | null>(null);
  const [flash, setFlash] = useState<'error' | 'success' | null>(null);
  const [, setDictReady] = useState(false);

  useEffect(() => {
    loadDictionary().then(() => setDictReady(true));
  }, []);

  // Clear any in-progress drag when the board changes (new round)
  useEffect(() => {
    draggingRef.current = false;
    pathLiveRef.current = [];
    setPath([]);
    setPointer(null);
    setFlash(null);
  }, [tiles]);

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const crect = container.getBoundingClientRect();
    centersRef.current = tileRefs.current.map((el) => {
      if (!el) return { x: 0, y: 0 };
      const r = el.getBoundingClientRect();
      tileSizeRef.current = r.width;
      return { x: r.left + r.width / 2 - crect.left, y: r.top + r.height / 2 - crect.top };
    });
  }, []);

  const toLocal = (e: React.PointerEvent): Pt => {
    const crect = containerRef.current!.getBoundingClientRect();
    return { x: e.clientX - crect.left, y: e.clientY - crect.top };
  };

  const hitTile = (p: Pt): number => {
    const radius = tileSizeRef.current * 0.38;
    let best = -1;
    let bestDist = Infinity;
    centersRef.current.forEach((c, i) => {
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < radius && d < bestDist) {
        best = i;
        bestDist = d;
      }
    });
    return best;
  };

  const onPointerDown = (e: React.PointerEvent, idx: number) => {
    if (disabled || flash) return;
    e.preventDefault();
    measure();
    try {
      containerRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // synthetic events / detached pointers can't be captured — drag still works via bubbling
    }
    draggingRef.current = true;
    updatePath([idx]);
    setPointer(toLocal(e));
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const p = toLocal(e);
    setPointer(p);
    const hit = hitTile(p);
    if (hit === -1) return;
    const prev = pathLiveRef.current;
    if (prev.length === 0) return;
    const last = prev[prev.length - 1];
    if (hit === last) return;
    // backtrack: sliding back onto the previous tile pops the last one
    if (prev.length >= 2 && hit === prev[prev.length - 2]) {
      updatePath(prev.slice(0, -1));
    } else if (!prev.includes(hit) && isAdjacent(last, hit)) {
      updatePath([...prev, hit]);
    }
  };

  const onPointerUp = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setPointer(null);

    const current = pathLiveRef.current;
    const word = pathToWord(tiles, current);
    const dict = getWords();
    const valid = current.length >= MIN_WORD_LEN && !!dict && dict.has(word);

    if (current.length === 0) return;
    if (!valid) {
      if (current.length > 1) {
        setFlash('error');
        setTimeout(() => {
          setFlash(null);
          updatePath([]);
        }, 600);
      } else {
        updatePath([]);
      }
      return;
    }

    setFlash('success');
    onSubmit(current).then((res) => {
      if (!res.ok) {
        setFlash('error');
        setTimeout(() => {
          setFlash(null);
          updatePath([]);
        }, 600);
      } else {
        setTimeout(() => {
          setFlash(null);
          updatePath([]);
        }, 700);
      }
    });
  };

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  const word = pathToWord(tiles, path);
  const dict = getWords();
  const isWord = path.length >= MIN_WORD_LEN && !!dict && dict.has(word);
  const points = isWord ? scoreWord(tiles, path) : 0;

  // SVG trail points
  const trail: Pt[] = path.map((i) => centersRef.current[i]).filter(Boolean);
  if (draggingRef.current && pointer && trail.length > 0) trail.push(pointer);
  const trailStr = trail.map((p) => `${p.x},${p.y}`).join(' ');

  const lineClass = flash === 'error' ? 'trail error' : isWord ? 'trail valid' : 'trail';

  // Score badge above the last selected tile
  const lastCenter = path.length > 0 ? centersRef.current[path[path.length - 1]] : null;

  return (
    <div
      className={`board ${flash === 'error' ? 'board-error' : ''}`}
      ref={containerRef}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <svg className="trail-svg">
        {trail.length > 1 && (
          <>
            <polyline className={`${lineClass} trail-under`} points={trailStr} />
            <polyline className={lineClass} points={trailStr} />
          </>
        )}
      </svg>

      <div className="grid">
        {tiles.map((tile, i) => {
          const selected = path.includes(i);
          const order = path.indexOf(i);
          const cls = [
            'tile',
            selected ? 'selected' : '',
            selected && flash === 'error' ? 'tile-error' : '',
            selected && flash === 'success' ? 'tile-success' : '',
            selected && isWord && !flash ? 'tile-valid' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div
              key={i}
              ref={(el) => {
                tileRefs.current[i] = el;
              }}
              className={cls}
              style={selected ? { transitionDelay: `${order * 12}ms` } : undefined}
              onPointerDown={(e) => onPointerDown(e, i)}
            >
              <span className="tile-letter">{tile.letter}</span>
              <span className="tile-points">{LETTER_VALUES[tile.letter] * tile.letterMult}</span>
              {tile.letterMult > 1 && <span className="badge badge-dl">DL</span>}
              {tile.wordMult > 1 && <span className="badge badge-2x">2X</span>}
            </div>
          );
        })}
      </div>

      {isWord && lastCenter && flash !== 'error' && (
        <div className="score-pop" style={{ left: lastCenter.x, top: lastCenter.y - tileSizeRef.current * 0.85 }}>
          <span className="score-pop-word">{word}</span>
          <span className="score-pop-points">+{points}</span>
        </div>
      )}

    </div>
  );
}
