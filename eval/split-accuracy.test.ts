import { it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { parseMidi } from '../src/midi/parse';
import { extractNotes, tempoMap, ticksToSeconds } from '../src/analysis/notes';
import { trackName } from '../src/midi/meta';
import { SPLIT_ALGORITHMS, defaultParams } from '../src/analysis/split';
import { ticksPerBeat } from '../src/midi/types';

/**
 * Accuracy benchmark for the hand-split algorithms. Point MIDI_DIR at a folder of piano MIDI files whose
 * hands are already in separate tracks named "...right..." and "...left..." (for example piano-midi.de files).
 * Every algorithm splits the merged notes and is scored against those tracks.
 *   MIDI_DIR=~/midi/bench npx vitest run eval --silent=false
 * Optional: ALGOS=beam,chord to limit algorithms, OVR='{"beam":{"reach":13}}' to override parameters.
 */
const DIR = process.env.MIDI_DIR ?? '';
const ONLY = process.env.ALGOS?.split(',');
const OVR = process.env.OVR ? JSON.parse(process.env.OVR) : {};

it.skipIf(!DIR || !existsSync(DIR))('split accuracy', () => {
  const tot: Record<string, { ok: number; n: number; runs: number[] }> = {};
  for (const f of readdirSync(DIR).filter((x) => x.endsWith('.mid')).sort()) {
    const m = parseMidi(readFileSync(`${DIR}/${f}`));
    const notes = extractNotes(m);
    const truth = new Map<string, 'R' | 'L'>();
    for (const n of notes) {
      const name = trackName(m, n.track).toLowerCase();
      if (/right|rechts/.test(name)) truth.set(n.id, 'R');
      else if (/left|links/.test(name)) truth.set(n.id, 'L');
    }
    const ns = notes.filter((n) => truth.has(n.id));
    const map = tempoMap(m);
    const ctx = { ticksPerBeat: ticksPerBeat(m), seconds: (t: number) => ticksToSeconds(m, t, map) };
    const sorted = [...ns].sort((a, b) => a.start - b.start);
    const cells: string[] = [];
    const t0 = performance.now();
    for (const a of SPLIT_ALGORITHMS) {
      if (ONLY && !ONLY.includes(a.id)) continue;
      const h = a.run(ns, { ...defaultParams(a), ...(OVR[a.id] ?? {}) }, ctx);
      let ok = 0, run = 0, maxRun = 0;
      let wStart = -1, maxSecs = 0;
      for (const x of sorted) {
        if (h.get(x.id) === truth.get(x.id)) { ok++; run = 0; wStart = -1; }
        else { run++; maxRun = Math.max(maxRun, run); if (wStart < 0) wStart = ctx.seconds(x.start); maxSecs = Math.max(maxSecs, ctx.seconds(x.start) - wStart); }
      }
      tot[a.id] ??= { ok: 0, n: 0, runs: [] };
      tot[a.id].ok += ok; tot[a.id].n += ns.length; tot[a.id].runs.push(maxRun);
      cells.push(`${a.id} ${((ok / ns.length) * 100).toFixed(1)}% run${maxRun}/${maxSecs.toFixed(1)}s`);
    }
    console.log(f.padEnd(22), String(ns.length).padStart(5), cells.join(' | '), `${(performance.now() - t0).toFixed(0)}ms`);
  }
  for (const [k, v] of Object.entries(tot)) console.log('TOTAL', k, ((v.ok / v.n) * 100).toFixed(2) + '%', 'worst run', Math.max(...v.runs));
}, 600000);
