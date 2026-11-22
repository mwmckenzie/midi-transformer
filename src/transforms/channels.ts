import { isChannelEvent, type ChannelEvent, type MidiEvent, type MidiFile } from '../midi/types';

export interface ChannelSummary {
  channel: number;
  noteCount: number;
  tracks: number[];
  programs: number[];
  minPitch: number;
  maxPitch: number;
}

export function summarizeChannels(file: MidiFile): ChannelSummary[] {
  const m = new Map<number, ChannelSummary>();
  file.tracks.forEach((t, ti) => {
    for (const e of t.events) {
      if (!isChannelEvent(e)) continue;
      let s = m.get(e.channel);
      if (!s) {
        s = { channel: e.channel, noteCount: 0, tracks: [], programs: [], minPitch: 127, maxPitch: 0 };
        m.set(e.channel, s);
      }
      if (!s.tracks.includes(ti)) s.tracks.push(ti);
      if (e.kind === 'programChange' && !s.programs.includes(e.program)) s.programs.push(e.program);
      if (e.kind === 'noteOn' && e.velocity > 0) {
        s.noteCount++;
        s.minPitch = Math.min(s.minPitch, e.note);
        s.maxPitch = Math.max(s.maxPitch, e.note);
      }
    }
  });
  return [...m.values()].sort((a, b) => a.channel - b.channel);
}

/**
 * Rewrites channel numbers. `map[c]` is the new channel for old channel c.
 * When `tracks` is given only those tracks are touched.
 */
export function remapChannels(file: MidiFile, map: number[], tracks?: number[]): MidiFile {
  return {
    ...file,
    tracks: file.tracks.map((t, ti) =>
      tracks && !tracks.includes(ti)
        ? t
        : {
            events: t.events.map((e) =>
              isChannelEvent(e) && map[e.channel] !== e.channel ? ({ ...e, channel: map[e.channel] } as MidiEvent) : e,
            ),
          },
    ),
  };
}

export function identityMap(): number[] {
  return Array.from({ length: 16 }, (_, i) => i);
}

export function swapChannels(file: MidiFile, a: number, b: number, tracks?: number[]): MidiFile {
  const map = identityMap();
  map[a] = b;
  map[b] = a;
  return remapChannels(file, map, tracks);
}

/** Sets the instrument for a channel. Existing program changes on it are replaced; one is added if none exist. */
export function setProgram(file: MidiFile, channel: number, program: number): MidiFile {
  let found = false;
  const tracks = file.tracks.map((t) => ({
    events: t.events.map((e) => {
      if (e.kind === 'programChange' && e.channel === channel) {
        found = true;
        return { ...e, program };
      }
      return e;
    }),
  }));
  if (!found) {
    const ti = tracks.findIndex((t) => t.events.some((e) => isChannelEvent(e) && e.channel === channel));
    if (ti >= 0) {
      const pc: ChannelEvent = { kind: 'programChange', tick: 0, channel, program };
      tracks[ti] = { events: [pc, ...tracks[ti].events] };
    }
  }
  return { ...file, tracks };
}

/** Removes every channel event on the given channel. */
export function deleteChannel(file: MidiFile, channel: number): MidiFile {
  return {
    ...file,
    tracks: file.tracks.map((t) => ({ events: t.events.filter((e) => !(isChannelEvent(e) && e.channel === channel)) })),
  };
}

/** Moves every event in a track to one channel (useful when a track's notes are spread across channels). */
export function setTrackChannel(file: MidiFile, track: number, channel: number): MidiFile {
  return {
    ...file,
    tracks: file.tracks.map((t, ti) =>
      ti !== track ? t : { events: t.events.map((e) => (isChannelEvent(e) ? ({ ...e, channel } as MidiEvent) : e)) },
    ),
  };
}
