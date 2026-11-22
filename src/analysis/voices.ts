import type { MidiFile } from '../midi/types';
import { trackName } from '../midi/meta';
import { voiceId, type Note } from './notes';

export interface VoiceStats {
  id: string;
  track: number;
  channel: number;
  trackName: string;
  program: number | undefined;
  noteCount: number;
  minPitch: number;
  maxPitch: number;
  meanPitch: number;
  medianPitch: number;
  p10: number;
  p90: number;
  /** Average number of notes sounding at each onset. */
  avgPolyphony: number;
  maxPolyphony: number;
  /** Fraction of onsets where the sounding notes span more than one hand can reach. */
  wideSpanRatio: number;
  /** Largest empty gap (semitones) inside the 10–90th percentile band of the pitch histogram. */
  histogramGap: number;
}

/** Semitones beyond which simultaneous notes are unlikely to be played by one hand. */
export const ONE_HAND_REACH = 15;

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}

/** For each note onset, the notes sounding at that instant (including the new one). */
export function soundingAtOnsets(notes: Note[]): { tick: number; pitches: number[] }[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const out: { tick: number; pitches: number[] }[] = [];
  let active: Note[] = [];
  let i = 0;
  while (i < sorted.length) {
    const tick = sorted[i].start;
    active = active.filter((n) => n.end > tick);
    while (i < sorted.length && sorted[i].start === tick) active.push(sorted[i++]);
    out.push({ tick, pitches: active.map((n) => n.pitch) });
  }
  return out;
}

export function groupByVoice(notes: Note[]): Map<string, Note[]> {
  const m = new Map<string, Note[]>();
  for (const n of notes) {
    const k = voiceId(n);
    const arr = m.get(k);
    if (arr) arr.push(n);
    else m.set(k, [n]);
  }
  return m;
}

export function firstProgram(file: MidiFile, track: number, channel: number): number | undefined {
  // Prefer a program change in the same track, then any track on that channel.
  for (const tr of [file.tracks[track], ...file.tracks]) {
    const e = tr?.events.find((x) => x.kind === 'programChange' && x.channel === channel);
    if (e && e.kind === 'programChange') return e.program;
  }
  return undefined;
}

export function computeVoiceStats(file: MidiFile, notes: Note[]): VoiceStats[] {
  const out: VoiceStats[] = [];
  for (const [id, vn] of groupByVoice(notes)) {
    const pitches = vn.map((n) => n.pitch).sort((a, b) => a - b);
    const onsets = soundingAtOnsets(vn);
    let polySum = 0;
    let polyMax = 0;
    let wide = 0;
    for (const o of onsets) {
      polySum += o.pitches.length;
      polyMax = Math.max(polyMax, o.pitches.length);
      if (Math.max(...o.pitches) - Math.min(...o.pitches) > ONE_HAND_REACH) wide++;
    }
    const p10 = percentile(pitches, 0.1);
    const p90 = percentile(pitches, 0.9);
    const hist = new Array(128).fill(0);
    for (const p of pitches) hist[p]++;
    let gap = 0;
    let run = 0;
    for (let p = p10; p <= p90; p++) {
      run = hist[p] === 0 ? run + 1 : 0;
      gap = Math.max(gap, run);
    }
    const { track, channel } = vn[0];
    out.push({
      id, track, channel,
      trackName: trackName(file, track),
      program: firstProgram(file, track, channel),
      noteCount: vn.length,
      minPitch: pitches[0],
      maxPitch: pitches[pitches.length - 1],
      meanPitch: pitches.reduce((a, b) => a + b, 0) / pitches.length,
      medianPitch: percentile(pitches, 0.5),
      p10, p90,
      avgPolyphony: onsets.length ? polySum / onsets.length : 0,
      maxPolyphony: polyMax,
      wideSpanRatio: onsets.length ? wide / onsets.length : 0,
      histogramGap: gap,
    });
  }
  return out.sort((a, b) => a.track - b.track || a.channel - b.channel);
}
