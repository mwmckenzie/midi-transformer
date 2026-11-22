import { META, type MetaEvent, type MidiFile } from './types';

const utf8 = new TextDecoder('utf-8', { fatal: true });
const latin1 = new TextDecoder('latin1');
const enc = new TextEncoder();

/** MIDI text has no declared encoding. Try UTF-8 first, fall back to Latin-1. */
export function decodeText(data: Uint8Array): string {
  try {
    return utf8.decode(data);
  } catch {
    return latin1.decode(data);
  }
}

export function encodeText(s: string): Uint8Array {
  return enc.encode(s);
}

export function tempoToBpm(data: Uint8Array): number {
  if (data.length < 3) return 120;
  const uspq = (data[0] << 16) | (data[1] << 8) | data[2];
  return 60_000_000 / uspq;
}

export function bpmToTempoData(bpm: number): Uint8Array {
  const uspq = Math.round(60_000_000 / Math.max(1, bpm));
  return Uint8Array.of((uspq >> 16) & 0xff, (uspq >> 8) & 0xff, uspq & 0xff);
}

export function formatTimeSignature(data: Uint8Array): string {
  if (data.length < 2) return '?';
  return `${data[0]}/${2 ** data[1]}`;
}

export function parseTimeSignature(s: string): Uint8Array | null {
  const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(s);
  if (!m) return null;
  const num = Number(m[1]);
  const den = Number(m[2]);
  const pow = Math.log2(den);
  if (!Number.isInteger(pow) || num < 1 || num > 255) return null;
  return Uint8Array.of(num, pow, 24, 8);
}

const MAJOR = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
const MINOR = ['Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#'];

export function formatKeySignature(data: Uint8Array): string {
  if (data.length < 2) return '?';
  const sf = (data[0] << 24) >> 24; // signed
  const minor = data[1] === 1;
  const name = (minor ? MINOR : MAJOR)[sf + 7];
  return name ? `${name} ${minor ? 'minor' : 'major'}` : '?';
}

export function parseKeySignature(s: string): Uint8Array | null {
  const m = /^\s*([A-Ga-g][#b]?)\s*(major|minor|maj|min|m)?\s*$/i.exec(s);
  if (!m) return null;
  const root = m[1][0].toUpperCase() + m[1].slice(1);
  const minor = !!m[2] && /^m(in(or)?)?$/i.test(m[2]);
  const idx = (minor ? MINOR : MAJOR).indexOf(root);
  if (idx < 0) return null;
  return Uint8Array.of((idx - 7) & 0xff, minor ? 1 : 0);
}

/** Human-readable value of any meta event, used for display and batch searching. */
export function metaDisplayValue(e: MetaEvent): string {
  switch (e.metaType) {
    case META.tempo:
      return `${tempoToBpm(e.data).toFixed(2)} BPM`;
    case META.timeSignature:
      return formatTimeSignature(e.data);
    case META.keySignature:
      return formatKeySignature(e.data);
    case META.channelPrefix:
    case META.midiPort:
      return String(e.data[0] ?? '');
    case META.endOfTrack:
      return '';
    default:
      if (e.metaType >= 0x01 && e.metaType <= 0x0f) return decodeText(e.data);
      return hex(e.data);
  }
}

export function hex(data: Uint8Array): string {
  return Array.from(data, (b) => b.toString(16).padStart(2, '0')).join(' ');
}

export function trackName(file: MidiFile, trackIndex: number): string {
  const ev = file.tracks[trackIndex]?.events.find(
    (e): e is MetaEvent => e.kind === 'meta' && e.metaType === META.trackName,
  );
  return ev ? decodeText(ev.data) : '';
}

export function setTrackName(file: MidiFile, trackIndex: number, name: string): MidiFile {
  const tracks = file.tracks.map((t, i) => {
    if (i !== trackIndex) return t;
    const idx = t.events.findIndex((e) => e.kind === 'meta' && e.metaType === META.trackName);
    const ev: MetaEvent = { kind: 'meta', tick: 0, metaType: META.trackName, data: encodeText(name) };
    const events = [...t.events];
    if (idx >= 0) events[idx] = { ...(events[idx] as MetaEvent), data: ev.data };
    else events.unshift(ev);
    return { events };
  });
  return { ...file, tracks };
}
