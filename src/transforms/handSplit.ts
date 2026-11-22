import { encodeText } from '../midi/meta';
import { isChannelEvent, META, type MidiEvent, type MidiFile } from '../midi/types';
import { voiceId, type Note } from '../analysis/notes';
import type { Hand } from '../analysis/split';

export interface HandApplyOptions {
  rightChannel: number;
  leftChannel: number;
  /** inPlace keeps notes in their tracks; twoTracks moves them into new "Right Hand" / "Left Hand" tracks. */
  layout: 'inPlace' | 'twoTracks';
}

export const DEFAULT_HAND_OPTIONS: HandApplyOptions = { rightChannel: 0, leftChannel: 1, layout: 'inPlace' };

/** Builds a hand assignment from whole voices (e.g. "track 1 ch 3 is the right hand"). */
export function assignByVoice(notes: Note[], voiceHands: Record<string, Hand | undefined>): Map<string, Hand> {
  const m = new Map<string, Hand>();
  for (const n of notes) {
    const h = voiceHands[voiceId(n)];
    if (h) m.set(n.id, h);
  }
  return m;
}

/**
 * Moves the assigned notes onto the right/left hand channels. Channel-wide events (program, controllers
 * such as sustain, pitch bend) from each affected source voice are copied to whichever hand channels
 * that voice's notes ended up on, so both hands keep the same instrument and pedalling.
 */
export function applyHandAssignment(
  file: MidiFile,
  notes: Note[],
  hands: Map<string, Hand>,
  opts: HandApplyOptions,
): MidiFile {
  const chFor = (h: Hand) => (h === 'R' ? opts.rightChannel : opts.leftChannel);
  // Per track: event index -> target channel for note events.
  const noteTarget = file.tracks.map(() => new Map<number, number>());
  // Which hands each source voice feeds.
  const voiceHandsUsed = new Map<string, Set<Hand>>();
  for (const n of notes) {
    const h = hands.get(n.id);
    if (!h) continue;
    noteTarget[n.track].set(n.onIndex, chFor(h));
    if (n.offIndex >= 0) noteTarget[n.track].set(n.offIndex, chFor(h));
    const k = voiceId(n);
    if (!voiceHandsUsed.has(k)) voiceHandsUsed.set(k, new Set());
    voiceHandsUsed.get(k)!.add(h);
  }

  const isAffected = (track: number, e: MidiEvent) => isChannelEvent(e) && voiceHandsUsed.has(`${track}:${e.channel}`);

  if (opts.layout === 'inPlace') {
    const tracks = file.tracks.map((t, ti) => {
      const events: MidiEvent[] = [];
      t.events.forEach((e, i) => {
        const target = noteTarget[ti].get(i);
        if (target !== undefined && isChannelEvent(e)) {
          events.push({ ...e, channel: target });
        } else if (isAffected(ti, e) && isChannelEvent(e) && e.kind !== 'noteOn' && e.kind !== 'noteOff') {
          const used = voiceHandsUsed.get(`${ti}:${e.channel}`)!;
          const chans = [...new Set([...used].map(chFor))];
          for (const c of chans) events.push({ ...e, channel: c });
        } else if (target === undefined && isChannelEvent(e) && (e.kind === 'noteOn' || e.kind === 'noteOff') && isAffected(ti, e)) {
          // Unpaired note event (e.g. stray note-off) in a split voice: leave it on the right-hand channel.
          events.push({ ...e, channel: opts.rightChannel });
        } else {
          events.push(e);
        }
      });
      return { events };
    });
    return { ...file, tracks };
  }

  // twoTracks: pull affected voices out of their tracks into dedicated hand tracks.
  const rh: MidiEvent[] = [nameEvent('Right Hand')];
  const lh: MidiEvent[] = [nameEvent('Left Hand')];
  const tracks = file.tracks.map((t, ti) => {
    const events: MidiEvent[] = [];
    t.events.forEach((e, i) => {
      if (!isAffected(ti, e) || !isChannelEvent(e)) {
        events.push(e);
        return;
      }
      const target = noteTarget[ti].get(i);
      if (target !== undefined) {
        (target === opts.rightChannel ? rh : lh).push({ ...e, channel: target });
        return;
      }
      if (e.kind === 'noteOn' || e.kind === 'noteOff') {
        rh.push({ ...e, channel: opts.rightChannel });
        return;
      }
      const used = voiceHandsUsed.get(`${ti}:${e.channel}`)!;
      if (used.has('R')) rh.push({ ...e, channel: opts.rightChannel });
      if (used.has('L')) lh.push({ ...e, channel: opts.leftChannel });
    });
    return { events };
  });
  const byTick = (a: MidiEvent, b: MidiEvent) => a.tick - b.tick;
  rh.sort(byTick);
  lh.sort(byTick);
  return { ...file, format: 1, tracks: [...tracks, { events: rh }, { events: lh }] };
}

function nameEvent(name: string): MidiEvent {
  return { kind: 'meta', tick: 0, metaType: META.trackName, data: encodeText(name) };
}
