// Core in-memory representation of a Standard MIDI File.
// Events carry absolute ticks so edits never have to juggle delta times;
// deltas are recomputed when the file is written.

export type ChannelEvent =
  | { kind: 'noteOn'; tick: number; channel: number; note: number; velocity: number }
  | { kind: 'noteOff'; tick: number; channel: number; note: number; velocity: number }
  | { kind: 'polyAftertouch'; tick: number; channel: number; note: number; pressure: number }
  | { kind: 'controller'; tick: number; channel: number; controller: number; value: number }
  | { kind: 'programChange'; tick: number; channel: number; program: number }
  | { kind: 'channelAftertouch'; tick: number; channel: number; pressure: number }
  /** value is the raw 14-bit amount, 0..16383 (8192 = centre) */
  | { kind: 'pitchBend'; tick: number; channel: number; value: number };

export interface MetaEvent {
  kind: 'meta';
  tick: number;
  metaType: number;
  data: Uint8Array;
}

export interface SysexEvent {
  kind: 'sysex';
  tick: number;
  /** 0xF0 for a normal sysex, 0xF7 for an escape/continuation packet */
  status: 0xf0 | 0xf7;
  data: Uint8Array;
}

export type MidiEvent = ChannelEvent | MetaEvent | SysexEvent;

export interface MidiTrack {
  events: MidiEvent[];
}

export interface UnknownChunk {
  /** Position among the chunks: written after the track with this index (-1 = before all tracks). */
  afterTrack: number;
  id: string;
  data: Uint8Array;
}

export interface MidiFile {
  format: 0 | 1 | 2;
  /** Raw 16-bit division word. Positive = ticks per quarter note; bit 15 set = SMPTE. */
  division: number;
  tracks: MidiTrack[];
  unknownChunks: UnknownChunk[];
}

export function isChannelEvent(e: MidiEvent): e is ChannelEvent {
  return e.kind !== 'meta' && e.kind !== 'sysex';
}

export function ticksPerBeat(file: MidiFile): number {
  return file.division & 0x8000 ? 480 : file.division;
}

export const META = {
  sequenceNumber: 0x00,
  text: 0x01,
  copyright: 0x02,
  trackName: 0x03,
  instrumentName: 0x04,
  lyric: 0x05,
  marker: 0x06,
  cuePoint: 0x07,
  programName: 0x08,
  deviceName: 0x09,
  channelPrefix: 0x20,
  midiPort: 0x21,
  endOfTrack: 0x2f,
  tempo: 0x51,
  smpteOffset: 0x54,
  timeSignature: 0x58,
  keySignature: 0x59,
  sequencerSpecific: 0x7f,
} as const;

export const TEXT_META_TYPES = [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09];

export const META_NAMES: Record<number, string> = {
  0x00: 'Sequence number',
  0x01: 'Text',
  0x02: 'Copyright',
  0x03: 'Track name',
  0x04: 'Instrument name',
  0x05: 'Lyric',
  0x06: 'Marker',
  0x07: 'Cue point',
  0x08: 'Program name',
  0x09: 'Device name',
  0x20: 'Channel prefix',
  0x21: 'MIDI port',
  0x2f: 'End of track',
  0x51: 'Tempo',
  0x54: 'SMPTE offset',
  0x58: 'Time signature',
  0x59: 'Key signature',
  0x7f: 'Sequencer specific',
};

export function metaName(type: number): string {
  return META_NAMES[type] ?? `Meta 0x${type.toString(16).padStart(2, '0')}`;
}

export function isTextMeta(type: number): boolean {
  return TEXT_META_TYPES.includes(type);
}
