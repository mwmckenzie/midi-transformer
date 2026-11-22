import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Note } from '../analysis/notes';
import { noteName } from '../midi/gm';
import { formatBarBeat } from './common';

export interface Lane {
  key: string;
  label: string;
  notes: Note[];
  color: (n: Note) => string;
  dim?: (n: Note) => boolean;
  /** Ring drawn around a note, e.g. to mark a manual override. */
  outline?: (n: Note) => boolean;
  onNoteClick?: (n: Note) => void;
  describe?: (n: Note) => string;
}

interface Props {
  lanes: Lane[];
  tpb: number;
  totalTicks: number;
  sig: [number, number];
  laneHeight?: number;
}

const KEYS_W = 50;
const BLACK = new Set([1, 3, 6, 8, 10]);

export function PianoRoll({ lanes, tpb, totalTicks, sig, laneHeight = 220 }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewW, setViewW] = useState(800);
  const [scrollX, setScrollX] = useState(0);
  const [pxPerBeat, setPxPerBeat] = useState(40);
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);

  const [lo, hi] = useMemo(() => {
    let mn = 127;
    let mx = 0;
    for (const l of lanes) for (const n of l.notes) {
      mn = Math.min(mn, n.pitch);
      mx = Math.max(mx, n.pitch);
    }
    if (mn > mx) return [48, 84];
    mn -= 2;
    mx += 2;
    if (mx - mn < 24) {
      const c = (mx + mn) / 2;
      mn = Math.floor(c - 12);
      mx = Math.ceil(c + 12);
    }
    return [Math.max(0, mn), Math.min(127, mx)];
  }, [lanes]);

  const beats = Math.max(1, totalTicks / tpb);
  const contentW = beats * pxPerBeat + KEYS_W + 20;
  const rowH = laneHeight / (hi - lo + 1);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    setViewW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const fit = () => setPxPerBeat(Math.max(2, (viewW - KEYS_W - 20) / beats));

  const toX = (tick: number) => KEYS_W + (tick / tpb) * pxPerBeat - scrollX;
  const toY = (pitch: number) => (hi - pitch) * rowH;

  const hitTest = (lane: Lane, x: number, y: number): Note | undefined => {
    const tick = ((x - KEYS_W + scrollX) / pxPerBeat) * tpb;
    const pitch = hi - Math.floor(y / rowH);
    const slop = (3 / pxPerBeat) * tpb;
    return lane.notes.find((n) => n.pitch === pitch && n.start - slop <= tick && n.end + slop >= tick);
  };

  return (
    <div className="roll">
      <div className="roll-toolbar">
        <label>
          Zoom
          <input type="range" min={2} max={200} value={pxPerBeat} onChange={(e) => setPxPerBeat(Number(e.target.value))} />
        </label>
        <button className="btn small" onClick={fit}>Fit to width</button>
        <span className="muted">Range {noteName(lo)}–{noteName(hi)}</span>
      </div>
      <div className="roll-scroll" ref={scrollRef} onScroll={(e) => setScrollX(e.currentTarget.scrollLeft)}>
        <div style={{ width: contentW, position: 'relative' }}>
          <div className="roll-sticky" style={{ width: viewW }}>
            {lanes.map((lane) => (
              <div key={lane.key} className="roll-lane">
                <div className="roll-lane-label">{lane.label}</div>
                <LaneCanvas
                  lane={lane} width={viewW} height={laneHeight} lo={lo} hi={hi} rowH={rowH}
                  toX={toX} toY={toY} tpb={tpb} sig={sig} pxPerBeat={pxPerBeat} scrollX={scrollX} totalTicks={totalTicks}
                  onMove={(x, y, cx, cy) => {
                    const n = hitTest(lane, x, y);
                    setHover(n ? { x: cx, y: cy, text: describe(lane, n, tpb, sig) } : null);
                  }}
                  onLeave={() => setHover(null)}
                  onClick={(x, y) => {
                    const n = hitTest(lane, x, y);
                    if (n && lane.onNoteClick) lane.onNoteClick(n);
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
      {hover && (
        <div className="roll-tip" style={{ left: hover.x + 12, top: hover.y + 12 }}>
          {hover.text}
        </div>
      )}
    </div>
  );
}

function describe(lane: Lane, n: Note, tpb: number, sig: [number, number]) {
  const base = `${noteName(n.pitch)} (${n.pitch}) · vel ${n.velocity} · ${formatBarBeat(n.start, tpb, sig)} · track ${n.track}`;
  return lane.describe ? `${base} · ${lane.describe(n)}` : base;
}

interface CanvasProps {
  lane: Lane;
  width: number;
  height: number;
  lo: number;
  hi: number;
  rowH: number;
  toX: (t: number) => number;
  toY: (p: number) => number;
  tpb: number;
  sig: [number, number];
  pxPerBeat: number;
  scrollX: number;
  totalTicks: number;
  onMove: (x: number, y: number, clientX: number, clientY: number) => void;
  onLeave: () => void;
  onClick: (x: number, y: number) => void;
}

function LaneCanvas(p: CanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.max(1, Math.floor(p.width * dpr));
    c.height = Math.floor(p.height * dpr);
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(c);
    const v = (name: string) => css.getPropertyValue(name).trim();
    g.fillStyle = v('--roll-bg');
    g.fillRect(0, 0, p.width, p.height);

    // Black-key rows
    g.fillStyle = v('--roll-black');
    for (let pitch = p.lo; pitch <= p.hi; pitch++)
      if (BLACK.has(pitch % 12)) g.fillRect(KEYS_W, p.toY(pitch), p.width, p.rowH);

    // Beat and bar lines
    const beatTicks = (p.tpb * 4) / p.sig[1];
    const barTicks = beatTicks * p.sig[0];
    const startTick = Math.max(0, ((p.scrollX) / p.pxPerBeat) * p.tpb);
    const endTick = startTick + ((p.width - KEYS_W) / p.pxPerBeat) * p.tpb;
    const showBeats = (beatTicks / p.tpb) * p.pxPerBeat > 6;
    const barStep = Math.max(1, Math.ceil(40 / ((barTicks / p.tpb) * p.pxPerBeat)));
    g.font = '10px system-ui, sans-serif';
    for (let t = Math.floor(startTick / beatTicks) * beatTicks; t <= endTick; t += beatTicks) {
      const isBar = Math.abs(t % barTicks) < 1e-6;
      if (!isBar && !showBeats) continue;
      const x = p.toX(t);
      g.fillStyle = isBar ? v('--roll-bar') : v('--roll-grid');
      g.fillRect(Math.round(x), 0, 1, p.height);
      const bar = Math.round(t / barTicks) + 1;
      if (isBar && (bar - 1) % barStep === 0) {
        g.fillStyle = v('--muted');
        g.fillText(String(bar), x + 3, 10);
      }
    }
    // End marker
    g.fillStyle = v('--roll-bar');
    g.fillRect(Math.round(p.toX(p.totalTicks)), 0, 2, p.height);

    // Notes
    const minX = KEYS_W;
    for (const n of p.lane.notes) {
      const x1 = p.toX(n.start);
      const x2 = p.toX(n.end);
      if (x2 < minX || x1 > p.width) continue;
      const y = p.toY(n.pitch);
      const w = Math.max(2, x2 - x1 - 1);
      const h = Math.max(1.5, p.rowH - 1);
      g.globalAlpha = p.lane.dim?.(n) ? 0.12 : 0.55 + (n.velocity / 127) * 0.45;
      g.fillStyle = p.lane.color(n);
      g.fillRect(Math.max(minX, x1), y, w - Math.max(0, minX - x1), h);
      if (p.lane.outline?.(n)) {
        g.globalAlpha = 1;
        g.strokeStyle = v('--text');
        g.lineWidth = 1.5;
        g.strokeRect(Math.max(minX, x1) - 0.5, y - 0.5, w + 1, h + 1);
      }
    }
    g.globalAlpha = 1;

    // Keyboard gutter
    g.fillStyle = v('--roll-keys');
    g.fillRect(0, 0, KEYS_W, p.height);
    for (let pitch = p.lo; pitch <= p.hi; pitch++) {
      const y = p.toY(pitch);
      if (BLACK.has(pitch % 12)) {
        g.fillStyle = v('--roll-keys-black');
        g.fillRect(0, y, KEYS_W * 0.5, p.rowH);
      }
      if (pitch % 12 === 0) {
        g.fillStyle = v('--roll-bar');
        g.fillRect(0, y + p.rowH, p.width, 1);
        if (p.rowH * 12 > 24) {
          g.fillStyle = v('--muted');
          g.fillText(noteName(pitch), KEYS_W * 0.5 + 3, y + p.rowH - 1);
        }
      }
    }
  });

  const local = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  return (
    <canvas
      ref={ref}
      style={{ width: p.width, height: p.height, display: 'block', cursor: p.lane.onNoteClick ? 'pointer' : 'default' }}
      onMouseMove={(e) => {
        const [x, y] = local(e);
        p.onMove(x, y, e.clientX, e.clientY);
      }}
      onMouseLeave={p.onLeave}
      onClick={(e) => {
        const [x, y] = local(e);
        p.onClick(x, y);
      }}
    />
  );
}
