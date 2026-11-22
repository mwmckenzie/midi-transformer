import type { MidiEvent, MidiFile, MidiTrack } from './types';

class Writer {
  private buf: number[] = [];
  u8(v: number) {
    this.buf.push(v & 0xff);
  }
  u16(v: number) {
    this.u8(v >> 8);
    this.u8(v);
  }
  u32(v: number) {
    this.u8(v >>> 24);
    this.u8(v >>> 16);
    this.u8(v >>> 8);
    this.u8(v);
  }
  str(s: string) {
    for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i));
  }
  vlq(v: number) {
    v = Math.max(0, Math.floor(v));
    const stack = [v & 0x7f];
    v >>>= 7;
    while (v > 0) {
      stack.push((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    for (let i = stack.length - 1; i >= 0; i--) this.u8(stack[i]);
  }
  bytes(b: Uint8Array) {
    for (const x of b) this.buf.push(x);
  }
  get length() {
    return this.buf.length;
  }
  toUint8Array() {
    return Uint8Array.from(this.buf);
  }
}

/** Stable sort by tick. Keeps the relative order of events that share a tick. */
export function sortEvents(events: MidiEvent[]): MidiEvent[] {
  return events
    .map((e, i) => [e, i] as const)
    .sort((a, b) => a[0].tick - b[0].tick || a[1] - b[1])
    .map(([e]) => e);
}

/** Ensures events are tick-ordered and that exactly one End-of-Track meta closes the track. */
export function normalizeTrack(track: MidiTrack): MidiTrack {
  let eotTick = 0;
  const body: MidiEvent[] = [];
  for (const e of track.events) {
    if (e.kind === 'meta' && e.metaType === 0x2f) eotTick = Math.max(eotTick, e.tick);
    else body.push(e);
  }
  const sorted = sortEvents(body);
  const last = sorted.length ? sorted[sorted.length - 1].tick : 0;
  sorted.push({ kind: 'meta', tick: Math.max(eotTick, last), metaType: 0x2f, data: new Uint8Array(0) });
  return { events: sorted };
}

export function writeMidi(file: MidiFile): Uint8Array {
  const w = new Writer();
  w.str('MThd');
  w.u32(6);
  const format = file.format === 0 && file.tracks.length > 1 ? 1 : file.format;
  w.u16(format);
  w.u16(file.tracks.length);
  w.u16(file.division);

  const chunksAfter = (i: number) => file.unknownChunks.filter((c) => c.afterTrack === i);
  const writeChunk = (id: string, data: Uint8Array) => {
    w.str(id);
    w.u32(data.length);
    w.bytes(data);
  };
  for (const c of chunksAfter(-1)) writeChunk(c.id, c.data);
  file.tracks.forEach((t, i) => {
    writeChunk('MTrk', encodeTrack(normalizeTrack(t)));
    for (const c of chunksAfter(i)) writeChunk(c.id, c.data);
  });
  return w.toUint8Array();
}

function encodeTrack(track: MidiTrack): Uint8Array {
  const w = new Writer();
  let prev = 0;
  for (const e of track.events) {
    w.vlq(e.tick - prev);
    prev = e.tick;
    switch (e.kind) {
      case 'meta':
        w.u8(0xff);
        w.u8(e.metaType);
        w.vlq(e.data.length);
        w.bytes(e.data);
        break;
      case 'sysex':
        w.u8(e.status);
        w.vlq(e.data.length);
        w.bytes(e.data);
        break;
      case 'noteOff':
        w.u8(0x80 | e.channel);
        w.u8(e.note);
        w.u8(e.velocity);
        break;
      case 'noteOn':
        w.u8(0x90 | e.channel);
        w.u8(e.note);
        w.u8(e.velocity);
        break;
      case 'polyAftertouch':
        w.u8(0xa0 | e.channel);
        w.u8(e.note);
        w.u8(e.pressure);
        break;
      case 'controller':
        w.u8(0xb0 | e.channel);
        w.u8(e.controller);
        w.u8(e.value);
        break;
      case 'programChange':
        w.u8(0xc0 | e.channel);
        w.u8(e.program);
        break;
      case 'channelAftertouch':
        w.u8(0xd0 | e.channel);
        w.u8(e.pressure);
        break;
      case 'pitchBend':
        w.u8(0xe0 | e.channel);
        w.u8(e.value & 0x7f);
        w.u8((e.value >> 7) & 0x7f);
        break;
    }
  }
  return w.toUint8Array();
}
