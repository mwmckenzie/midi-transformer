import { useMemo, useState } from 'react';
import { GM_PROGRAMS, noteName, programName } from '../midi/gm';
import { trackName } from '../midi/meta';
import { isChannelEvent } from '../midi/types';
import type { LibFile, Library } from '../state/library';
import {
  deleteChannel, identityMap, remapChannels, setProgram, setTrackChannel, summarizeChannels, swapChannels,
} from '../transforms/channels';
import { CHANNEL_COLORS, ChannelSelect, Section, Swatch, useChannelLabel } from './common';

export function ChannelsPanel({ file, lib, checked }: { file: LibFile; lib: Library; checked: string[] }) {
  const m = file.midi;
  const ch = useChannelLabel();
  const chans = useMemo(() => summarizeChannels(m), [m]);
  const used = new Set(chans.map((c) => c.channel));
  const [targets, setTargets] = useState<Record<number, number>>({});
  const [scope, setScope] = useState<number | 'all'>('all');
  const [allChecked, setAllChecked] = useState(false);
  const [swapA, setSwapA] = useState<number | null>(null);
  const [swapB, setSwapB] = useState<number | null>(null);

  const ids = allChecked && checked.length ? [...new Set([file.id, ...checked])] : [file.id];
  const tracks = scope === 'all' ? undefined : [scope];
  const multiNote = ids.length > 1 ? ` (${ids.length} files)` : '';

  const map = identityMap();
  for (const [from, to] of Object.entries(targets)) map[Number(from)] = to;
  const moves = Object.entries(targets).filter(([f, t]) => Number(f) !== t);
  const merged = new Set<number>();
  {
    const dest = new Map<number, number[]>();
    for (const c of used) {
      const d = map[c];
      dest.set(d, [...(dest.get(d) ?? []), c]);
    }
    for (const [d, srcs] of dest) if (srcs.length > 1) merged.add(d);
  }

  const pickTarget = (from: number, to: number) => {
    const next = { ...targets, [from]: to };
    // Picking a channel already in use swaps the two, unless that channel is already being moved.
    if (used.has(to) && to !== from && targets[to] === undefined) next[to] = from;
    // Undo the automatic swap if the user changes their mind.
    if (targets[from] !== undefined && targets[from] !== to && targets[targets[from]] === from) delete next[targets[from]];
    setTargets(next);
  };

  return (
    <div className="stack">
      <Section
        title="Channels"
        actions={
          <>
            <label>Scope <select value={scope} onChange={(e) => setScope(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
              <option value="all">All tracks</option>
              {m.tracks.map((_, i) => <option key={i} value={i}>Track {i} {trackName(m, i) && `· ${trackName(m, i)}`}</option>)}
            </select></label>
            {checked.length > 1 && (
              <label className="check">
                <input type="checkbox" checked={allChecked} onChange={(e) => setAllChecked(e.target.checked)} />
                Apply to all {checked.length} checked files
              </label>
            )}
          </>
        }
      >
        <table className="grid">
          <thead>
            <tr><th>Channel</th><th className="num">Notes</th><th>Range</th><th>Tracks</th><th>Instrument</th><th>Move to</th><th /></tr>
          </thead>
          <tbody>
            {chans.map((c) => (
              <tr key={c.channel}>
                <td><Swatch color={CHANNEL_COLORS[c.channel]} /> {ch(c.channel)}{c.channel === 9 && <span className="muted small"> drums</span>}</td>
                <td className="num">{c.noteCount}</td>
                <td className="nowrap">{c.noteCount ? `${noteName(c.minPitch)}–${noteName(c.maxPitch)}` : '—'}</td>
                <td>{c.tracks.join(', ')}</td>
                <td>
                  <select
                    value={c.programs.length === 1 ? c.programs[0] : c.programs.length ? 'multi' : 'none'}
                    onChange={(e) => {
                      const p = Number(e.target.value);
                      lib.update(ids, `Set ch ${ch(c.channel)} to ${GM_PROGRAMS[p]}`, (f) => ({ ...f, midi: setProgram(f.midi, c.channel, p) }));
                    }}
                  >
                    {c.programs.length === 0 && <option value="none">{programName(undefined, c.channel)}</option>}
                    {c.programs.length > 1 && <option value="multi">Several: {c.programs.map((p) => GM_PROGRAMS[p]).join(', ')}</option>}
                    {GM_PROGRAMS.map((name, p) => <option key={p} value={p}>{p}. {name}</option>)}
                  </select>
                </td>
                <td>
                  <ChannelSelect value={targets[c.channel] ?? c.channel} onChange={(to) => to !== null && pickTarget(c.channel, to)} />
                </td>
                <td>
                  <button
                    className="btn icon" title="Delete all events on this channel"
                    onClick={() => confirm(`Delete every event on channel ${ch(c.channel)}?`) &&
                      lib.update(ids, `Delete ch ${ch(c.channel)}`, (f) => ({ ...f, midi: deleteChannel(f.midi, c.channel) }))}
                  >✕</button>
                </td>
              </tr>
            ))}
            {!chans.length && <tr><td colSpan={7} className="muted">This file has no channel events.</td></tr>}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 10 }}>
          <button
            className="btn primary" disabled={!moves.length}
            onClick={() => {
              lib.update(ids, 'Remap channels', (f) => ({ ...f, midi: remapChannels(f.midi, map, tracks) }));
              setTargets({});
            }}
          >Apply channel changes{multiNote}</button>
          <button className="btn" disabled={!moves.length} onClick={() => setTargets({})}>Reset</button>
          <span className="muted small">
            {moves.length ? moves.map(([f, t]) => `${ch(Number(f))} → ${ch(t)}`).join(', ') : 'Pick a new channel in “Move to”. Picking a used channel swaps them.'}
          </span>
          {merged.size > 0 && <span className="warn small">Channels will merge into {[...merged].map(ch).join(', ')}.</span>}
        </div>
      </Section>

      <Section title="Quick swap">
        <div className="row">
          <ChannelSelect value={swapA} onChange={setSwapA} allowNone noneLabel="Channel…" />
          <span>⇄</span>
          <ChannelSelect value={swapB} onChange={setSwapB} allowNone noneLabel="Channel…" />
          <button
            className="btn" disabled={swapA === null || swapB === null || swapA === swapB}
            onClick={() => lib.update(ids, `Swap ch ${ch(swapA!)} and ${ch(swapB!)}`, (f) => ({ ...f, midi: swapChannels(f.midi, swapA!, swapB!, tracks) }))}
          >Swap{multiNote}</button>
        </div>
      </Section>

      <Section title="Put a whole track on one channel">
        <table className="grid">
          <tbody>
            {m.tracks.map((t, i) => {
              const tc = [...new Set(t.events.filter(isChannelEvent).map((e) => e.channel))].sort((a, b) => a - b);
              if (!tc.length) return null;
              return (
                <tr key={i}>
                  <td>Track {i}</td>
                  <td>{trackName(m, i) || <span className="muted">(unnamed)</span>}</td>
                  <td>uses {tc.map(ch).join(', ')}</td>
                  <td>
                    <ChannelSelect
                      value={tc.length === 1 ? tc[0] : null} allowNone noneLabel="Mixed…"
                      onChange={(c) => c !== null && lib.update([file.id], `Track ${i} to ch ${ch(c)}`, (f) => ({ ...f, midi: setTrackChannel(f.midi, i, c) }))}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>
    </div>
  );
}
