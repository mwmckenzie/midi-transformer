import { describe, expect, it } from 'vitest';
import { parseMidi } from './midi/parse';
import { writeMidi } from './midi/write';
import { demoCombined, demoSeparate, demoTruth } from './midi/demo';
import { extractNotes } from './analysis/notes';
import { computeVoiceStats } from './analysis/voices';
import { detectHands } from './analysis/hands';
import { SPLIT_ALGORITHMS, defaultParams } from './analysis/split';
import { applyHandAssignment, assignByVoice } from './transforms/handSplit';
import { applyBatch } from './transforms/batch';
import { remapChannels, setProgram, summarizeChannels, swapChannels } from './transforms/channels';
import { formatKeySignature, parseKeySignature, tempoToBpm, bpmToTempoData } from './midi/meta';

describe('MIDI read/write', () => {
  it('round-trips byte-for-byte after one normalisation pass', () => {
    const a = writeMidi(demoSeparate());
    const b = writeMidi(parseMidi(a));
    expect(b).toEqual(a);
  });

  it('parses running status and note-on velocity 0', () => {
    // Format 0, 1 track, 96 tpq. Note on C4, then running-status note-on vel 0.
    const trk = [0x00, 0x90, 60, 100, 0x60, 60, 0, 0x00, 0xff, 0x2f, 0x00];
    const bytes = Uint8Array.from([
      0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96,
      0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, trk.length, ...trk,
    ]);
    const f = parseMidi(bytes);
    const notes = extractNotes(f);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ pitch: 60, start: 0, end: 96 });
  });

  it('keeps unknown chunks and sysex', () => {
    const f = demoSeparate();
    f.unknownChunks.push({ afterTrack: 0, id: 'XFIH', data: Uint8Array.of(1, 2, 3) });
    f.tracks[1].events.push({ kind: 'sysex', tick: 0, status: 0xf0, data: Uint8Array.of(0x7e, 0x7f, 9, 1, 0xf7) });
    const g = parseMidi(writeMidi(f));
    expect(g.unknownChunks[0]).toMatchObject({ id: 'XFIH', afterTrack: 0 });
    expect(g.tracks[1].events.some((e) => e.kind === 'sysex')).toBe(true);
  });

  it('meta helpers', () => {
    expect(tempoToBpm(bpmToTempoData(96))).toBeCloseTo(96, 1);
    expect(formatKeySignature(parseKeySignature('F# minor')!)).toBe('F# minor');
    expect(formatKeySignature(parseKeySignature('Bb')!)).toBe('Bb major');
  });
});

describe('channel transforms', () => {
  it('swaps and remaps channels', () => {
    const f = swapChannels(demoSeparate(), 5, 2);
    const chans = summarizeChannels(f).map((c) => c.channel);
    expect(chans).toEqual([0, 2, 5]);
    expect(summarizeChannels(f).find((c) => c.channel === 2)!.tracks).toEqual([1]);
    const map = Array.from({ length: 16 }, (_, i) => i);
    map[5] = 0;
    map[0] = 9;
    const g = remapChannels(demoSeparate(), map);
    expect(summarizeChannels(g).map((c) => c.channel)).toEqual([0, 2, 9]);
  });

  it('sets program', () => {
    const f = setProgram(demoSeparate(), 0, 40);
    expect(summarizeChannels(f).find((c) => c.channel === 0)!.programs).toEqual([40]);
  });
});

describe('batch edit', () => {
  it('replaces in filenames and track names, deletes markers', () => {
    const r = applyBatch(
      { name: 'Song [demo].mid', midi: demoSeparate() },
      { targets: ['filename', 3], find: 'Piano ', replace: '', mode: 'replace', regex: false, caseSensitive: false, keepExtension: true },
    );
    expect(r.changes.map((c) => c.after)).toEqual(['RH', 'LH']);
    const r2 = applyBatch(
      { name: 'Song [demo].mid', midi: demoSeparate() },
      { targets: ['filename'], find: '\\s*\\[demo\\]', replace: '', mode: 'replace', regex: true, caseSensitive: false, keepExtension: true },
    );
    expect(r2.name).toBe('Song.mid');
    const r3 = applyBatch(
      { name: 'x.mid', midi: demoSeparate() },
      { targets: [6], find: '', replace: '', mode: 'delete', regex: false, caseSensitive: false, keepExtension: true },
    );
    expect(r3.changes).toHaveLength(2);
  });
});

describe('hand detection and splitting', () => {
  it('detects separate hands by name and pitch', () => {
    const f = demoSeparate();
    const d = detectHands(computeVoiceStats(f, extractNotes(f)));
    expect(d.right).toBe('1:5');
    expect(d.left).toBe('2:2');
  });

  it('flags a combined two-hand voice', () => {
    const f = demoCombined();
    const d = detectHands(computeVoiceStats(f, extractNotes(f)));
    expect(d.combined).toEqual(['1:3']);
  });

  for (const algo of SPLIT_ALGORITHMS) {
    it(`${algo.name} splits the demo mostly correctly`, () => {
      const f = demoCombined();
      const notes = extractNotes(f);
      const hands = algo.run(notes, defaultParams(algo), { ticksPerBeat: 480 });
      const truth = demoTruth();
      const correct = notes.filter((n) => hands.get(n.id) === truth.get(`${n.start}:${n.pitch}`)).length;
      expect(correct / notes.length).toBeGreaterThan(0.9);
    });
  }

  it('applies a split in place and in two tracks', () => {
    const f = demoCombined();
    const notes = extractNotes(f);
    const algo = SPLIT_ALGORITHMS[0];
    const hands = algo.run(notes, defaultParams(algo), { ticksPerBeat: 480 });
    const inPlace = parseMidi(writeMidi(applyHandAssignment(f, notes, hands, { rightChannel: 0, leftChannel: 1, layout: 'inPlace' })));
    const s = summarizeChannels(inPlace);
    expect(s.map((c) => c.channel)).toEqual([0, 1]);
    expect(s[0].noteCount + s[1].noteCount).toBe(notes.length);
    expect(s[1].programs).toEqual([0]); // program copied to the LH channel
    const two = applyHandAssignment(f, notes, hands, { rightChannel: 0, leftChannel: 1, layout: 'twoTracks' });
    expect(two.tracks).toHaveLength(4);
    expect(extractNotes(two).length).toBe(notes.length);
    // Sustain pedal copied to both hands
    expect(two.tracks[2].events.filter((e) => e.kind === 'controller')).toHaveLength(2);
    expect(two.tracks[3].events.filter((e) => e.kind === 'controller')).toHaveLength(2);
  });

  it('assigns whole voices', () => {
    const f = demoSeparate();
    const notes = extractNotes(f);
    const out = applyHandAssignment(f, notes, assignByVoice(notes, { '1:5': 'R', '2:2': 'L' }), { rightChannel: 0, leftChannel: 1, layout: 'inPlace' });
    const s = summarizeChannels(out);
    expect(s.find((c) => c.channel === 1)!.tracks).toEqual([2]);
  });
});
