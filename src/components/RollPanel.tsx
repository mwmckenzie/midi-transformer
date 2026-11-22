import { useMemo, useState } from 'react';
import { extractNotes, lastTick, voiceId, type Note } from '../analysis/notes';
import { programName } from '../midi/gm';
import { trackName } from '../midi/meta';
import { ticksPerBeat } from '../midi/types';
import type { LibFile } from '../state/library';
import { CHANNEL_COLORS, Section, Swatch, firstTimeSig, useChannelLabel } from './common';
import { PianoRoll, type Lane } from './PianoRoll';
import { firstProgram } from '../analysis/voices';

type Layout = 'combined' | 'channel' | 'track';

export function RollPanel({ file }: { file: LibFile }) {
  const m = file.midi;
  const ch = useChannelLabel();
  const notes = useMemo(() => extractNotes(m), [m]);
  const [layout, setLayout] = useState<Layout>('channel');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [height, setHeight] = useState(160);

  const voices = useMemo(() => {
    const seen = new Map<string, { id: string; track: number; channel: number; count: number }>();
    for (const n of notes) {
      const id = voiceId(n);
      const v = seen.get(id);
      if (v) v.count++;
      else seen.set(id, { id, track: n.track, channel: n.channel, count: 1 });
    }
    return [...seen.values()].sort((a, b) => a.channel - b.channel || a.track - b.track);
  }, [notes]);

  const shown = notes.filter((n) => !hidden.has(voiceId(n)));
  const color = (n: Note) => CHANNEL_COLORS[n.channel];
  const describe = (n: Note) => `ch ${ch(n.channel)}`;
  const lanes: Lane[] = (() => {
    if (layout === 'combined') return [{ key: 'all', label: 'All visible notes', notes: shown, color, describe }];
    const keyOf = (n: Note) => (layout === 'channel' ? n.channel : n.track);
    const groups = new Map<number, Note[]>();
    for (const n of shown) {
      const g = groups.get(keyOf(n));
      if (g) g.push(n);
      else groups.set(keyOf(n), [n]);
    }
    return [...groups.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([k, ns]) => ({
        key: String(k),
        label: layout === 'channel'
          ? `Channel ${ch(k)} · ${programName(firstProgram(m, ns[0].track, k), k)} · ${ns.length} notes`
          : `Track ${k}${trackName(m, k) ? ` · ${trackName(m, k)}` : ''} · ${ns.length} notes`,
        notes: ns, color, describe,
      }));
  })();

  const toggle = (id: string) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setHidden(next);
  };

  return (
    <div className="stack">
      <Section
        title="Piano roll"
        actions={
          <>
            <label>Lanes <select value={layout} onChange={(e) => setLayout(e.target.value as Layout)}>
              <option value="channel">One per channel</option>
              <option value="track">One per track</option>
              <option value="combined">All in one</option>
            </select></label>
            <label>Height <input type="range" min={80} max={480} value={height} onChange={(e) => setHeight(Number(e.target.value))} /></label>
          </>
        }
      >
        <div className="legend">
          {voices.map((v) => (
            <label key={v.id} className={`chip toggle ${hidden.has(v.id) ? 'off' : ''}`}>
              <input type="checkbox" checked={!hidden.has(v.id)} onChange={() => toggle(v.id)} />
              <Swatch color={CHANNEL_COLORS[v.channel]} /> ch {ch(v.channel)} · track {v.track}
              {trackName(m, v.track) && ` (${trackName(m, v.track)})`} · {v.count}
            </label>
          ))}
        </div>
        <PianoRoll lanes={lanes} tpb={ticksPerBeat(m)} totalTicks={lastTick(m)} sig={firstTimeSig(m)} laneHeight={height} />
      </Section>
    </div>
  );
}
