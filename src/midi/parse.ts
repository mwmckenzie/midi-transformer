import type { MidiEvent, MidiFile, MidiTrack, UnknownChunk } from './types';

export class MidiParseError extends Error {}

class Reader {
  pos = 0;
  bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }
  get eof() {
    return this.pos >= this.bytes.length;
  }
  u8(): number {
    if (this.pos >= this.bytes.length) throw new MidiParseError('Unexpected end of data');
    return this.bytes[this.pos++];
  }
  u16(): number {
    return (this.u8() << 8) | this.u8();
  }
  u32(): number {
    return ((this.u8() << 24) >>> 0) + (this.u8() << 16) + (this.u8() << 8) + this.u8();
  }
  str(n: number): string {
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.u8());
    return s;
  }
  vlq(): number {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const b = this.u8();
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) return v;
    }
    throw new MidiParseError('Variable-length quantity too long');
  }
  bytesN(n: number): Uint8Array {
    if (this.pos + n > this.bytes.length) throw new MidiParseError('Unexpected end of data');
    const out = this.bytes.slice(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
}

export function parseMidi(input: ArrayBuffer | Uint8Array): MidiFile {
  let bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  // RIFF-wrapped MIDI (.rmi): find the embedded MThd.
  if (bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF') {
    const idx = indexOfMThd(bytes);
    if (idx >= 0) bytes = bytes.slice(idx);
  }
  const r = new Reader(bytes);
  if (r.str(4) !== 'MThd') throw new MidiParseError('Not a MIDI file (missing MThd header)');
  const headerLen = r.u32();
  const format = r.u16();
  const nTracks = r.u16();
  const division = r.u16();
  r.pos += headerLen - 6;
  if (format > 2) throw new MidiParseError(`Unsupported MIDI format ${format}`);

  const tracks: MidiTrack[] = [];
  const unknownChunks: UnknownChunk[] = [];
  while (!r.eof && r.bytes.length - r.pos >= 8) {
    const id = r.str(4);
    let len = r.u32();
    if (r.pos + len > bytes.length) len = bytes.length - r.pos; // tolerate truncated files
    if (id === 'MTrk') {
      tracks.push(parseTrack(new Reader(r.bytesN(len))));
    } else {
      unknownChunks.push({ afterTrack: tracks.length - 1, id, data: r.bytesN(len) });
    }
  }
  if (tracks.length === 0 && nTracks > 0) throw new MidiParseError('No tracks found');
  return { format: format as 0 | 1 | 2, division, tracks, unknownChunks };
}

function indexOfMThd(b: Uint8Array): number {
  for (let i = 0; i < b.length - 4; i++) {
    if (b[i] === 0x4d && b[i + 1] === 0x54 && b[i + 2] === 0x68 && b[i + 3] === 0x64) return i;
  }
  return -1;
}

function parseTrack(r: Reader): MidiTrack {
  const events: MidiEvent[] = [];
  let tick = 0;
  let running = 0;
  while (!r.eof) {
    tick += r.vlq();
    let status = r.bytes[r.pos];
    if (status & 0x80) {
      r.pos++;
    } else {
      if (!running) throw new MidiParseError('Data byte without running status');
      status = running;
    }

    if (status === 0xff) {
      running = 0;
      const metaType = r.u8();
      const len = r.vlq();
      events.push({ kind: 'meta', tick, metaType, data: r.bytesN(len) });
      if (metaType === 0x2f) break;
      continue;
    }
    if (status === 0xf0 || status === 0xf7) {
      running = 0;
      const len = r.vlq();
      events.push({ kind: 'sysex', tick, status, data: r.bytesN(len) });
      continue;
    }
    if (status >= 0xf1) {
      // System common/realtime bytes do not belong in SMF; skip them defensively.
      running = 0;
      continue;
    }

    running = status;
    const type = status & 0xf0;
    const channel = status & 0x0f;
    const d1 = r.u8();
    switch (type) {
      case 0x80:
        events.push({ kind: 'noteOff', tick, channel, note: d1, velocity: r.u8() });
        break;
      case 0x90:
        events.push({ kind: 'noteOn', tick, channel, note: d1, velocity: r.u8() });
        break;
      case 0xa0:
        events.push({ kind: 'polyAftertouch', tick, channel, note: d1, pressure: r.u8() });
        break;
      case 0xb0:
        events.push({ kind: 'controller', tick, channel, controller: d1, value: r.u8() });
        break;
      case 0xc0:
        events.push({ kind: 'programChange', tick, channel, program: d1 });
        break;
      case 0xd0:
        events.push({ kind: 'channelAftertouch', tick, channel, pressure: d1 });
        break;
      case 0xe0: {
        const d2 = r.u8();
        events.push({ kind: 'pitchBend', tick, channel, value: d1 | (d2 << 7) });
        break;
      }
    }
  }
  return { events };
}
