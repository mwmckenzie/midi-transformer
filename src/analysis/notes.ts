import { META, ticksPerBeat, type MidiFile } from '../midi/types';
import { tempoToBpm } from '../midi/meta';

export interface Note {
  /** Stable within one extraction: `${track}:${onIndex}` */
  id: string;
  track: number;
  channel: number;
  pitch: number;
  velocity: number;
  start: number;
  end: number;
  onIndex: number;
  /** Index of the matching note-off event, or -1 when the note was never released. */
  offIndex: number;
}

/** A "voice" is a (track, channel) pair, the unit we classify as a hand. */
export interface VoiceKey {
  track: number;
  channel: number;
}

export const voiceId = (v: VoiceKey) => `${v.track}:${v.channel}`;

/**
 * Pairs note-on/note-off events. Overlapping notes of the same pitch are matched first-in first-out,
 * which is how most sequencers write them.
 */
export function extractNotes(file: MidiFile): Note[] {
  const notes: Note[] = [];
  file.tracks.forEach((track, t) => {
    const open = new Map<number, Note[]>();
    let lastTick = 0;
    track.events.forEach((e, i) => {
      lastTick = Math.max(lastTick, e.tick);
      if (e.kind !== 'noteOn' && e.kind !== 'noteOff') return;
      const key = e.channel * 128 + e.note;
      if (e.kind === 'noteOn' && e.velocity > 0) {
        const n: Note = {
          id: `${t}:${i}`, track: t, channel: e.channel, pitch: e.note, velocity: e.velocity,
          start: e.tick, end: e.tick, onIndex: i, offIndex: -1,
        };
        notes.push(n);
        const q = open.get(key);
        if (q) q.push(n);
        else open.set(key, [n]);
      } else {
        const n = open.get(key)?.shift();
        if (n) {
          n.end = e.tick;
          n.offIndex = i;
        }
      }
    });
    for (const q of open.values()) for (const n of q) n.end = Math.max(n.start + 1, lastTick);
  });
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return notes;
}

export interface TempoPoint {
  tick: number;
  bpm: number;
}

export function tempoMap(file: MidiFile): TempoPoint[] {
  const pts: TempoPoint[] = [];
  for (const t of file.tracks)
    for (const e of t.events)
      if (e.kind === 'meta' && e.metaType === META.tempo) pts.push({ tick: e.tick, bpm: tempoToBpm(e.data) });
  pts.sort((a, b) => a.tick - b.tick);
  if (!pts.length || pts[0].tick > 0) pts.unshift({ tick: 0, bpm: 120 });
  return pts;
}

export function ticksToSeconds(file: MidiFile, tick: number, map = tempoMap(file)): number {
  const tpb = ticksPerBeat(file);
  let secs = 0;
  for (let i = 0; i < map.length; i++) {
    const from = map[i].tick;
    if (from >= tick) break;
    const to = Math.min(tick, map[i + 1]?.tick ?? Infinity);
    secs += ((to - from) / tpb) * (60 / map[i].bpm);
  }
  return secs;
}

export function lastTick(file: MidiFile): number {
  let max = 0;
  for (const t of file.tracks) for (const e of t.events) if (e.tick > max) max = e.tick;
  return max;
}

export function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
