import type { Note } from './notes';
import { beamSplit } from './splitBeam';

export type Hand = 'R' | 'L';

export interface ParamSpec {
  key: string;
  label: string;
  type: 'number' | 'note';
  default: number;
  min?: number;
  max?: number;
  step?: number;
  help?: string;
}

export interface SplitContext {
  ticksPerBeat: number;
  /** Converts a tick to seconds using the file's tempo map. Falls back to 120 BPM when absent. */
  seconds?: (tick: number) => number;
}

/**
 * A split algorithm assigns every note of the voices being split to a hand.
 * New algorithms only need to implement this interface and be added to SPLIT_ALGORITHMS.
 */
export interface SplitAlgorithm {
  id: string;
  name: string;
  description: string;
  params: ParamSpec[];
  run(notes: Note[], params: Record<string, number>, ctx: SplitContext): Map<string, Hand>;
}

export function defaultParams(a: SplitAlgorithm): Record<string, number> {
  return Object.fromEntries(a.params.map((p) => [p.key, p.default]));
}

// ---------------------------------------------------------------------------

const fixedSplit: SplitAlgorithm = {
  id: 'fixed',
  name: 'Fixed split point',
  description: 'Every note at or above the split pitch goes to the right hand. Simple and predictable.',
  params: [{ key: 'split', label: 'Split at', type: 'note', default: 60, min: 0, max: 127, help: 'Notes at or above go right' }],
  run(notes, p) {
    return new Map(notes.map((n) => [n.id, n.pitch >= p.split ? 'R' : 'L']));
  },
};

// ---------------------------------------------------------------------------

const movingSplit: SplitAlgorithm = {
  id: 'moving',
  name: 'Moving split point',
  description:
    'The split point follows the music: for each note it is the midpoint between the high and low registers ' +
    'played in a window around it. Handles pieces that move up and down the keyboard.',
  params: [
    { key: 'window', label: 'Window (beats)', type: 'number', default: 4, min: 0.5, max: 32, step: 0.5 },
    { key: 'fallback', label: 'Fallback split', type: 'note', default: 60, min: 0, max: 127, help: 'Used when the window holds one register only' },
    { key: 'minGap', label: 'Min register gap', type: 'number', default: 7, min: 0, max: 36, help: 'Semitones between registers before trusting the window' },
  ],
  run(notes, p, ctx) {
    const half = (p.window * ctx.ticksPerBeat) / 2;
    const sorted = [...notes].sort((a, b) => a.start - b.start);
    const out = new Map<string, Hand>();
    let lo = 0;
    let hi = 0;
    for (const n of sorted) {
      while (lo < sorted.length && sorted[lo].start < n.start - half) lo++;
      while (hi < sorted.length && sorted[hi].start <= n.start + half) hi++;
      const win = sorted.slice(lo, hi).map((x) => x.pitch).sort((a, b) => a - b);
      // Split at the largest gap among window pitches, if it is big enough.
      let best = -1;
      let bestGap = 0;
      for (let i = 1; i < win.length; i++) {
        const g = win[i] - win[i - 1];
        if (g > bestGap) {
          bestGap = g;
          best = i;
        }
      }
      let split = p.fallback;
      if (best > 0 && bestGap >= p.minGap) split = (win[best] + win[best - 1]) / 2;
      out.set(n.id, n.pitch >= split ? 'R' : 'L');
    }
    return out;
  },
};

// ---------------------------------------------------------------------------

/**
 * Chord-aware split with hand continuity. Notes starting together form a cluster; for every cluster
 * we try each way of cutting it (lowest k notes to the left hand) and pick the cheapest, where cost
 * penalises a hand stretching wider than its reach, too many notes in one hand, and jumping away
 * from where that hand was recently playing. Notes still held by a hand count toward its stretch.
 */
const chordContinuity: SplitAlgorithm = {
  id: 'chord',
  name: 'Chord-aware (note by note)',
  description:
    'Groups notes that start together, then cuts each group where it best fits two hands: each hand stays ' +
    'within its reach, holds at most five notes, and stays near where it was just playing.',
  params: [
    { key: 'reach', label: 'Hand reach (semitones)', type: 'number', default: 14, min: 7, max: 24 },
    { key: 'cluster', label: 'Chord tolerance (beats)', type: 'number', default: 0.0625, min: 0, max: 1, step: 0.03125, help: 'Notes starting within this time count as one chord' },
    { key: 'inertia', label: 'Position weight', type: 'number', default: 1, min: 0, max: 5, step: 0.1, help: 'How strongly a hand prefers to stay put' },
    { key: 'startR', label: 'Right hand start', type: 'note', default: 67, min: 0, max: 127 },
    { key: 'startL', label: 'Left hand start', type: 'note', default: 48, min: 0, max: 127 },
  ],
  run(notes, p, ctx) {
    const tol = p.cluster * ctx.ticksPerBeat;
    const sorted = [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    const out = new Map<string, Hand>();
    let posR = p.startR;
    let posL = p.startL;
    const held: { R: Note[]; L: Note[] } = { R: [], L: [] };

    let i = 0;
    while (i < sorted.length) {
      const t0 = sorted[i].start;
      const cluster: Note[] = [];
      while (i < sorted.length && sorted[i].start - t0 <= tol) cluster.push(sorted[i++]);
      cluster.sort((a, b) => a.pitch - b.pitch);
      held.R = held.R.filter((n) => n.end > t0 + tol);
      held.L = held.L.filter((n) => n.end > t0 + tol);

      const cost = (k: number) => {
        const L = cluster.slice(0, k).map((n) => n.pitch).concat(held.L.map((n) => n.pitch));
        const R = cluster.slice(k).map((n) => n.pitch).concat(held.R.map((n) => n.pitch));
        let c = 0;
        for (const [ps, pos, hand] of [[L, posL, 'L'], [R, posR, 'R']] as const) {
          if (!ps.length) continue;
          const span = Math.max(...ps) - Math.min(...ps);
          if (span > p.reach) c += (span - p.reach) * 4;
          if (ps.length > 5) c += (ps.length - 5) * 10;
          const newOnes = hand === 'L' ? cluster.slice(0, k) : cluster.slice(k);
          if (newOnes.length) {
            const mean = newOnes.reduce((a, n) => a + n.pitch, 0) / newOnes.length;
            c += p.inertia * Math.abs(mean - pos) * 0.5;
          }
        }
        // Hands should not cross: highest LH note below lowest RH note.
        const lTop = k > 0 ? cluster[k - 1].pitch : -Infinity;
        const rBottom = k < cluster.length ? cluster[k].pitch : Infinity;
        const heldLTop = Math.max(-Infinity, ...held.L.map((n) => n.pitch));
        const heldRBottom = Math.min(Infinity, ...held.R.map((n) => n.pitch));
        if (Math.max(lTop, heldLTop) > Math.min(rBottom, heldRBottom)) c += 6;
        return c;
      };

      let bestK = 0;
      let bestC = Infinity;
      for (let k = 0; k <= cluster.length; k++) {
        const c = cost(k);
        if (c < bestC - 1e-9) {
          bestC = c;
          bestK = k;
        }
      }
      const L = cluster.slice(0, bestK);
      const R = cluster.slice(bestK);
      for (const n of L) out.set(n.id, 'L');
      for (const n of R) out.set(n.id, 'R');
      held.L.push(...L);
      held.R.push(...R);
      const smooth = 0.5;
      if (L.length) posL = posL * (1 - smooth) + (L.reduce((a, n) => a + n.pitch, 0) / L.length) * smooth;
      if (R.length) posR = posR * (1 - smooth) + (R.reduce((a, n) => a + n.pitch, 0) / R.length) * smooth;
      // Keep the two tracked positions from collapsing onto each other.
      if (posR - posL < 5) {
        const mid = (posR + posL) / 2;
        posR = mid + 2.5;
        posL = mid - 2.5;
      }
    }
    return out;
  },
};

export const SPLIT_ALGORITHMS: SplitAlgorithm[] = [beamSplit, chordContinuity, movingSplit, fixedSplit];

export function getAlgorithm(id: string): SplitAlgorithm {
  return SPLIT_ALGORITHMS.find((a) => a.id === id) ?? SPLIT_ALGORITHMS[0];
}
