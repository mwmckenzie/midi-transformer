# MIDI Transformer

A static, browser-only web app for organising, inspecting, editing and transforming MIDI files.
Nothing is uploaded: files are parsed in the browser and kept in IndexedDB on your machine.

## Features (phase 1)

- **Library**: open or drag-drop many `.mid` files, duplicate, rename, remove, export one `.mid` or many as `.zip`.
  Per-file undo/redo (Ctrl/Cmd+Z, Ctrl+Shift+Z) and revert to original. Library persists across reloads.
- **Overview**: format, resolution, duration, tempo, time/key signature, track table with editable names.
- **Metadata**: every meta event (text, copyright, track/instrument names, lyrics, markers, tempo, time and key
  signature…) in an editable table; add, retype, move or delete events.
- **Batch edit**: find/replace (plain or regex) or delete matching events across filenames and any text metadata
  type, on all ticked files, with a live preview.
- **Channels & instruments**: remap or swap channels (whole file or one track, optionally across all ticked files),
  set GM instruments, delete a channel, put a whole track on one channel. Channel numbers display 0–15 or 1–16.
- **Piano roll**: lanes per channel/track or combined, voice toggles, zoom, hover details.

## Hands (early phase 2)

- **Detection** scores each (track, channel) "voice" as right hand, left hand, both hands, or other, with reasons
  (track names, median pitch, how often simultaneous notes exceed one hand's reach, register gaps, density).
- **Split algorithms** for voices holding both hands (`src/analysis/split.ts`):
  - *Phrase look-ahead* (default): beam search that keeps the best readings of the whole piece, with a register
    prior, no hand crossing, chord grouping in milliseconds and softer limits from long-held notes. This stops a single
    wrong guess from swapping the hands for bars, which the note-by-note algorithm could do on human performances.
  - *Chord-aware (note by note)*: greedy; cuts each chord where it best fits two hands (reach, ≤5 notes, continuity).
  - *Moving split point*: splits at the largest register gap within a sliding window.
  - *Fixed split point*.
- **Compare** current channels vs. the proposal (and optionally every algorithm) in stacked piano rolls;
  click notes to flip them manually.
- **Apply** right hand → channel 0 and left hand → channel 1 (configurable), in place or as two new tracks,
  copying instrument/pedal/controller events to both hands. Apply to the file or save as a copy.

### Measuring split accuracy

`eval/split-accuracy.test.ts` scores every algorithm against files whose hands are already in tracks named
"right"/"left" (e.g. piano-midi.de files): `MIDI_DIR=/path/to/files npx vitest run eval --silent=false`.
On 15 piano-midi.de pieces: phrase look-ahead 89.5% of notes correct, chord-aware 86.6%, moving 79.1%, fixed 78.8%.

## Architecture

```
src/midi/        lossless SMF parser/writer, meta helpers, GM names, demo files
src/analysis/    note extraction, per-voice stats, hand detection, split algorithms (pluggable)
src/transforms/  pure MidiFile -> MidiFile functions: channels, batch edits, hand split
src/state/       library (undo history), IndexedDB storage, zip export
src/components/  React panels and the canvas piano roll
```

Transforms are pure functions, so they are unit-tested (`npm test`) and reused for single files and batches.
A new split algorithm only has to implement `SplitAlgorithm` and be added to `SPLIT_ALGORITHMS`.

## Develop

```
npm install
npm run dev      # local dev server
npm test         # unit tests
npm run build    # static build in dist/
```

Pushing to `main` deploys to GitHub Pages via `.github/workflows/deploy.yml`
(enable Pages → Source: GitHub Actions in the repository settings).
