import { bpmToTempoData, encodeText } from './meta';
import type { MidiEvent, MidiFile } from './types';

const TPB = 480;

interface N {
  p: number;
  s: number;
  d: number;
  v?: number;
  hand: 'R' | 'L';
}

/** A short two-handed piano piece used to try the app without loading files. */
function demoNotes(): N[] {
  const notes: N[] = [];
  // I - vi - IV - V in C, 4 bars each repeated twice, the second time an octave higher in the right hand.
  const chords = [
    [48, 52, 55], [45, 48, 52], [41, 45, 48], [43, 47, 50],
  ];
  const melody = [
    [76, 74, 72, 74], [76, 76, 76, 79], [77, 76, 74, 72], [74, 71, 74, 67],
  ];
  for (let rep = 0; rep < 2; rep++) {
    chords.forEach((ch, bar) => {
      const barStart = (rep * 4 + bar) * 4 * TPB;
      // Left hand: root on beat 1, broken chord on beats 2-4.
      notes.push({ p: ch[0] - 12, s: barStart, d: TPB * 2, v: 80, hand: 'L' });
      ch.forEach((p, k) => notes.push({ p, s: barStart + TPB * (k + 1), d: TPB, v: 64, hand: 'L' }));
      // Right hand: melody plus a held third below on beat 1.
      melody[bar].forEach((p, k) => {
        const pp = p + rep * 12;
        notes.push({ p: pp, s: barStart + TPB * k, d: TPB * 0.9, v: 90, hand: 'R' });
      });
      notes.push({ p: melody[bar][0] - 4 + rep * 12, s: barStart, d: TPB * 2, v: 70, hand: 'R' });
    });
  }
  // Ending: wide chord across both hands.
  const end = 8 * 4 * TPB;
  for (const p of [36, 43, 48]) notes.push({ p, s: end, d: TPB * 4, v: 80, hand: 'L' });
  for (const p of [64, 67, 72, 76]) notes.push({ p, s: end, d: TPB * 4, v: 90, hand: 'R' });
  return notes;
}

function noteEvents(notes: N[], channel: (n: N) => number): MidiEvent[] {
  const evs: MidiEvent[] = [];
  for (const n of notes) {
    evs.push({ kind: 'noteOn', tick: n.s, channel: channel(n), note: n.p, velocity: n.v ?? 80 });
    evs.push({ kind: 'noteOff', tick: Math.round(n.s + n.d), channel: channel(n), note: n.p, velocity: 0 });
  }
  // Note-offs before note-ons at the same tick.
  return evs.sort((a, b) => a.tick - b.tick || (a.kind === 'noteOff' ? -1 : 1) - (b.kind === 'noteOff' ? -1 : 1));
}

const meta = (metaType: number, data: Uint8Array, tick = 0): MidiEvent => ({ kind: 'meta', tick, metaType, data });
const text = (metaType: number, s: string) => meta(metaType, encodeText(s));

function conductor(title: string): MidiEvent[] {
  return [
    text(0x03, title),
    text(0x02, '(c) Demo Publisher 2026'),
    meta(0x51, bpmToTempoData(96)),
    meta(0x58, Uint8Array.of(4, 2, 24, 8)),
    meta(0x59, Uint8Array.of(0, 0)),
    text(0x06, 'Verse'),
    meta(0x06, encodeText('Verse 2'), 4 * 4 * TPB),
  ];
}

/** Both hands in one track on channel 3: the case the split algorithms are for. */
export function demoCombined(): MidiFile {
  const notes = demoNotes();
  return {
    format: 1,
    division: TPB,
    unknownChunks: [],
    tracks: [
      { events: conductor('Demo - both hands in one channel') },
      {
        events: [
          text(0x03, 'Piano'),
          { kind: 'programChange', tick: 0, channel: 3, program: 0 },
          { kind: 'controller', tick: 0, channel: 3, controller: 64, value: 127 },
          { kind: 'controller', tick: 8 * 4 * TPB - 10, channel: 3, controller: 64, value: 0 },
          ...noteEvents(notes, () => 3),
        ],
      },
    ],
  };
}

/** Hands already separated, but on the wrong channels (RH on 5, LH on 2) with a strings part on 0. */
export function demoSeparate(): MidiFile {
  const notes = demoNotes();
  const strings = notes.filter((n) => n.hand === 'L' && n.s % (4 * TPB) === 0).map((n) => ({ ...n, p: n.p + 24, d: 4 * TPB }));
  return {
    format: 1,
    division: TPB,
    unknownChunks: [],
    tracks: [
      { events: conductor('Demo - separate hands, wrong channels') },
      { events: [text(0x03, 'Piano RH'), { kind: 'programChange', tick: 0, channel: 5, program: 0 }, ...noteEvents(notes.filter((n) => n.hand === 'R'), () => 5)] },
      { events: [text(0x03, 'Piano LH'), { kind: 'programChange', tick: 0, channel: 2, program: 0 }, ...noteEvents(notes.filter((n) => n.hand === 'L'), () => 2)] },
      { events: [text(0x03, 'Strings'), { kind: 'programChange', tick: 0, channel: 0, program: 48 }, ...noteEvents(strings, () => 0)] },
    ],
  };
}

/** Ground-truth hand for each note of demoCombined, keyed by start tick and pitch. */
export function demoTruth(): Map<string, 'R' | 'L'> {
  return new Map(demoNotes().map((n) => [`${n.s}:${n.p}`, n.hand]));
}
