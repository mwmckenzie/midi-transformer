import { useMemo } from 'react';
import { extractNotes, formatDuration, lastTick, tempoMap, ticksToSeconds } from '../analysis/notes';
import { setTrackName, trackName, metaDisplayValue } from '../midi/meta';
import { programName } from '../midi/gm';
import { isChannelEvent, META, ticksPerBeat, type MidiFile } from '../midi/types';
import type { LibFile, Library } from '../state/library';
import { CHANNEL_COLORS, CommitInput, Section, Swatch, firstTimeSig, useChannelLabel } from './common';
import { PianoRoll } from './PianoRoll';

export function OverviewPanel({ file, lib }: { file: LibFile; lib: Library }) {
  const m = file.midi;
  const ch = useChannelLabel();
  const notes = useMemo(() => extractNotes(m), [m]);
  const info = useMemo(() => fileInfo(m), [m]);
  const tracks = useMemo(
    () =>
      m.tracks.map((t, i) => {
        const chans = new Set<number>();
        const progs = new Map<number, number>();
        let n = 0;
        for (const e of t.events) {
          if (!isChannelEvent(e)) continue;
          chans.add(e.channel);
          if (e.kind === 'programChange' && !progs.has(e.channel)) progs.set(e.channel, e.program);
          if (e.kind === 'noteOn' && e.velocity > 0) n++;
        }
        return { i, name: trackName(m, i), events: t.events.length, notes: n, chans: [...chans].sort((a, b) => a - b), progs };
      }),
    [m],
  );

  return (
    <div className="stack">
      <Section title="File">
        <dl className="facts">
          <dt>Format</dt><dd>{m.format} {m.format === 0 ? '(single track)' : m.format === 1 ? '(multi-track)' : '(sequences)'}</dd>
          <dt>Resolution</dt><dd>{m.division & 0x8000 ? 'SMPTE' : `${m.division} ticks per beat`}</dd>
          <dt>Duration</dt><dd>{info.duration}</dd>
          <dt>Tempo</dt><dd>{info.tempo}</dd>
          <dt>Time signature</dt><dd>{info.timeSig}</dd>
          <dt>Key</dt><dd>{info.key}</dd>
          <dt>Notes</dt><dd>{notes.length}</dd>
          {info.copyright && (<><dt>Copyright</dt><dd>{info.copyright}</dd></>)}
        </dl>
      </Section>

      <Section title={`Tracks (${m.tracks.length})`}>
        <table className="grid">
          <thead>
            <tr><th>#</th><th>Name</th><th>Channels</th><th>Instruments</th><th className="num">Notes</th><th className="num">Events</th></tr>
          </thead>
          <tbody>
            {tracks.map((t) => (
              <tr key={t.i}>
                <td>{t.i}</td>
                <td>
                  <CommitInput
                    value={t.name}
                    placeholder="(unnamed)"
                    onCommit={(v) => lib.update([file.id], `Rename track ${t.i}`, (f) => ({ ...f, midi: setTrackName(f.midi, t.i, v) }))}
                  />
                </td>
                <td>
                  {t.chans.map((c) => (
                    <span key={c} className="chip"><Swatch color={CHANNEL_COLORS[c]} />{ch(c)}</span>
                  ))}
                </td>
                <td className="small">
                  {[...t.progs].map(([c, p]) => `${programName(p, c)}`).join(', ') || (t.chans.length ? programName(undefined, t.chans[0]) : '')}
                </td>
                <td className="num">{t.notes}</td>
                <td className="num">{t.events}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Preview">
        <PianoRoll
          lanes={[{ key: 'all', label: 'All notes, coloured by channel', notes, color: (n) => CHANNEL_COLORS[n.channel], describe: (n) => `ch ${ch(n.channel)}` }]}
          tpb={ticksPerBeat(m)} totalTicks={lastTick(m)} sig={firstTimeSig(m)} laneHeight={180}
        />
      </Section>
    </div>
  );
}

function fileInfo(m: MidiFile) {
  const map = tempoMap(m);
  const secs = ticksToSeconds(m, lastTick(m), map);
  const bpms = [...new Set(map.map((p) => p.bpm.toFixed(1)))];
  const find = (type: number) => {
    for (const t of m.tracks) for (const e of t.events) if (e.kind === 'meta' && e.metaType === type) return metaDisplayValue(e);
    return '';
  };
  return {
    duration: formatDuration(secs),
    tempo: bpms.length > 1 ? `${bpms[0]} BPM (+${bpms.length - 1} changes)` : `${bpms[0]} BPM`,
    timeSig: find(META.timeSignature) || '4/4 (default)',
    key: find(META.keySignature) || '—',
    copyright: find(META.copyright),
  };
}
