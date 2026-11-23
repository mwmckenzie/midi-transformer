import type { Note } from './notes';
import type { Hand, SplitAlgorithm, SplitContext } from './split';

/**
 * Phrase-level hand split using beam search.
 *
 * The greedy chord algorithm decides each chord once and never revisits it, so a single wrong call
 * (often an inner voice) can swap the two hands, and long held notes then keep them swapped until
 * they are released. This algorithm instead keeps the best `beam` partial readings of the piece and
 * only commits at the end, so a reading that went wrong is dropped once it becomes expensive.
 *
 * Costs for giving a chord's lowest k notes to the left hand and the rest to the right:
 *  - reach: a hand stretching wider than its reach, counting notes it still holds
 *    (notes held for longer than `holdSecs` count less, since the pedal can take over);
 *  - fingers: more than five notes in one hand;
 *  - movement: a hand jumping away from where it was just playing;
 *  - register prior: right-hand notes below the centre pitch and left-hand notes above it,
 *    which makes a swapped reading expensive for as long as it lasts;
 *  - crossing: the left hand's top note above the right hand's bottom note.
 * Notes that start within `chordMs` milliseconds of each other form one chord, which suits
 * human-played files where chord notes are slightly spread.
 */

interface Hyp {
  cost: number;
  posR: number;
  posL: number;
  heldR: Note[];
  heldL: Note[];
  trail: Trail | null;
}

interface Trail {
  prev: Trail | null;
  cluster: number;
  k: number;
}

interface Cluster {
  notes: Note[];
  time: number;
}

function defaultSeconds(ctx: SplitContext) {
  return (tick: number) => (tick / ctx.ticksPerBeat) * 0.5;
}

export function clusterByTime(notes: Note[], chordSecs: number, seconds: (t: number) => number): Cluster[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const out: Cluster[] = [];
  let i = 0;
  while (i < sorted.length) {
    const t0 = seconds(sorted[i].start);
    const notesIn: Note[] = [];
    while (i < sorted.length && seconds(sorted[i].start) - t0 <= chordSecs) notesIn.push(sorted[i++]);
    notesIn.sort((a, b) => a.pitch - b.pitch);
    out.push({ notes: notesIn, time: t0 });
  }
  return out;
}

const mean = (ns: Note[]) => ns.reduce((a, n) => a + n.pitch, 0) / ns.length;

export const beamSplit: SplitAlgorithm = {
  id: 'beam',
  name: 'Phrase look-ahead',
  description:
    'Keeps several possible readings of the music at once and picks the cheapest over the whole piece, so one ' +
    'wrong guess cannot flip the hands for bars. Prefers low notes left and high notes right, keeps hands from ' +
    'crossing, and groups slightly spread chords the way a human plays them.',
  params: [
    { key: 'reach', label: 'Hand reach (semitones)', type: 'number', default: 12, min: 7, max: 24 },
    { key: 'center', label: 'Register centre', type: 'note', default: 60, min: 24, max: 96, help: 'Pitch where neither hand is preferred' },
    { key: 'prior', label: 'Register weight', type: 'number', default: 0.1, min: 0, max: 3, step: 0.05, help: 'How strongly low notes prefer the left hand and high notes the right' },
    { key: 'inertia', label: 'Position weight', type: 'number', default: 1, min: 0, max: 5, step: 0.1 },
    { key: 'chordMs', label: 'Chord spread (ms)', type: 'number', default: 30, min: 0, max: 300, step: 5, help: 'Notes starting this close together count as one chord' },
    { key: 'holdSecs', label: 'Held-note limit (s)', type: 'number', default: 0.8, min: 0.1, max: 10, step: 0.1, help: 'Held longer than this, a note limits its hand less' },
    { key: 'beam', label: 'Readings kept', type: 'number', default: 32, min: 1, max: 256, help: 'More is slower but more thorough' },
  ],
  run(notes, p, ctx) {
    const seconds = ctx.seconds ?? defaultSeconds(ctx);
    const clusters = clusterByTime(notes, p.chordMs / 1000, seconds);
    const endSec = new Map<string, number>();
    const startSec = new Map<string, number>();
    for (const n of notes) {
      startSec.set(n.id, seconds(n.start));
      endSec.set(n.id, seconds(n.end));
    }

    let beam: Hyp[] = [{ cost: 0, posR: p.center + 7, posL: p.center - 12, heldR: [], heldL: [], trail: null }];

    clusters.forEach((cl, ci) => {
      const t = cl.time;
      const next = new Map<string, Hyp>();
      for (const h of beam) {
        const heldR = h.heldR.filter((n) => endSec.get(n.id)! > t + 0.01);
        const heldL = h.heldL.filter((n) => endSec.get(n.id)! > t + 0.01);
        for (let k = 0; k <= cl.notes.length; k++) {
          const L = cl.notes.slice(0, k);
          const R = cl.notes.slice(k);
          let c = 0;
          for (const [neu, held, pos, hand] of [[L, heldL, h.posL, 'L'], [R, heldR, h.posR, 'R']] as const) {
            if (!neu.length && !held.length) continue;
            const fresh = held.filter((n) => t - startSec.get(n.id)! < p.holdSecs);
            const all = [...neu, ...held].map((n) => n.pitch);
            const fr = [...neu, ...fresh].map((n) => n.pitch);
            const over = (ps: number[]) => (ps.length ? Math.max(0, Math.max(...ps) - Math.min(...ps) - p.reach) : 0);
            const overFresh = over(fr);
            c += overFresh * 4 + Math.max(0, over(all) - overFresh) * 1;
            if (fr.length > 5) c += (fr.length - 5) * 10;
            if (neu.length) {
              c += p.inertia * 0.5 * Math.abs(mean(neu) - pos);
              for (const n of neu)
                c += p.prior * (hand === 'R' ? Math.max(0, p.center - n.pitch) : Math.max(0, n.pitch - p.center));
            }
          }
          const lTop = Math.max(-Infinity, ...L.map((n) => n.pitch), ...heldL.filter((n) => t - startSec.get(n.id)! < p.holdSecs).map((n) => n.pitch));
          const rBot = Math.min(Infinity, ...R.map((n) => n.pitch), ...heldR.filter((n) => t - startSec.get(n.id)! < p.holdSecs).map((n) => n.pitch));
          if (lTop > rBot) c += 12 + 2 * (lTop - rBot);

          let posL = h.posL;
          let posR = h.posR;
          const s = 0.35;
          if (L.length) posL = posL * (1 - s) + mean(L) * s;
          if (R.length) posR = posR * (1 - s) + mean(R) * s;
          if (posR - posL < 3) {
            const mid = (posR + posL) / 2;
            posR = mid + 1.5;
            posL = mid - 1.5;
          }
          const nh: Hyp = {
            cost: h.cost + c, posR, posL,
            heldR: R.length ? [...heldR, ...R] : heldR,
            heldL: L.length ? [...heldL, ...L] : heldL,
            trail: { prev: h.trail, cluster: ci, k },
          };
          // Merge readings that have reached the same situation; keep the cheaper one.
          const key = `${Math.round(posR)}|${Math.round(posL)}|${nh.heldR.map((n) => n.id).join(',')}|${nh.heldL.map((n) => n.id).join(',')}`;
          const prev = next.get(key);
          if (!prev || prev.cost > nh.cost) next.set(key, nh);
        }
      }
      beam = [...next.values()].sort((a, b) => a.cost - b.cost).slice(0, Math.max(1, Math.round(p.beam)));
    });

    const out = new Map<string, Hand>();
    for (let tr = beam[0]?.trail ?? null; tr; tr = tr.prev) {
      const cl = clusters[tr.cluster];
      cl.notes.forEach((n, i) => out.set(n.id, i < tr.k ? 'L' : 'R'));
    }
    return out;
  },
};
