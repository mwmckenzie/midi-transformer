export const GM_PROGRAMS = [
  'Acoustic Grand Piano', 'Bright Acoustic Piano', 'Electric Grand Piano', 'Honky-tonk Piano',
  'Electric Piano 1', 'Electric Piano 2', 'Harpsichord', 'Clavinet',
  'Celesta', 'Glockenspiel', 'Music Box', 'Vibraphone', 'Marimba', 'Xylophone', 'Tubular Bells', 'Dulcimer',
  'Drawbar Organ', 'Percussive Organ', 'Rock Organ', 'Church Organ', 'Reed Organ', 'Accordion', 'Harmonica', 'Tango Accordion',
  'Acoustic Guitar (nylon)', 'Acoustic Guitar (steel)', 'Electric Guitar (jazz)', 'Electric Guitar (clean)',
  'Electric Guitar (muted)', 'Overdriven Guitar', 'Distortion Guitar', 'Guitar Harmonics',
  'Acoustic Bass', 'Electric Bass (finger)', 'Electric Bass (pick)', 'Fretless Bass',
  'Slap Bass 1', 'Slap Bass 2', 'Synth Bass 1', 'Synth Bass 2',
  'Violin', 'Viola', 'Cello', 'Contrabass', 'Tremolo Strings', 'Pizzicato Strings', 'Orchestral Harp', 'Timpani',
  'String Ensemble 1', 'String Ensemble 2', 'Synth Strings 1', 'Synth Strings 2', 'Choir Aahs', 'Voice Oohs', 'Synth Voice', 'Orchestra Hit',
  'Trumpet', 'Trombone', 'Tuba', 'Muted Trumpet', 'French Horn', 'Brass Section', 'Synth Brass 1', 'Synth Brass 2',
  'Soprano Sax', 'Alto Sax', 'Tenor Sax', 'Baritone Sax', 'Oboe', 'English Horn', 'Bassoon', 'Clarinet',
  'Piccolo', 'Flute', 'Recorder', 'Pan Flute', 'Blown Bottle', 'Shakuhachi', 'Whistle', 'Ocarina',
  'Lead 1 (square)', 'Lead 2 (sawtooth)', 'Lead 3 (calliope)', 'Lead 4 (chiff)',
  'Lead 5 (charang)', 'Lead 6 (voice)', 'Lead 7 (fifths)', 'Lead 8 (bass + lead)',
  'Pad 1 (new age)', 'Pad 2 (warm)', 'Pad 3 (polysynth)', 'Pad 4 (choir)',
  'Pad 5 (bowed)', 'Pad 6 (metallic)', 'Pad 7 (halo)', 'Pad 8 (sweep)',
  'FX 1 (rain)', 'FX 2 (soundtrack)', 'FX 3 (crystal)', 'FX 4 (atmosphere)',
  'FX 5 (brightness)', 'FX 6 (goblins)', 'FX 7 (echoes)', 'FX 8 (sci-fi)',
  'Sitar', 'Banjo', 'Shamisen', 'Koto', 'Kalimba', 'Bagpipe', 'Fiddle', 'Shanai',
  'Tinkle Bell', 'Agogo', 'Steel Drums', 'Woodblock', 'Taiko Drum', 'Melodic Tom', 'Synth Drum', 'Reverse Cymbal',
  'Guitar Fret Noise', 'Breath Noise', 'Seashore', 'Bird Tweet', 'Telephone Ring', 'Helicopter', 'Applause', 'Gunshot',
];

export function programName(p: number | undefined, channel?: number): string {
  if (channel === 9) return 'Drums (GM channel 10)';
  if (p === undefined) return 'Default (Acoustic Grand Piano)';
  return GM_PROGRAMS[p] ?? `Program ${p}`;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Note name with middle C (60) = C4. */
export function noteName(n: number): string {
  return `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
}

export function parseNoteName(s: string): number | null {
  const t = s.trim();
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    return n >= 0 && n <= 127 ? n : null;
  }
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(t);
  if (!m) return null;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase() as 'C'];
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  const n = (Number(m[3]) + 1) * 12 + base + acc;
  return n >= 0 && n <= 127 ? n : null;
}

export const CC_NAMES: Record<number, string> = {
  0: 'Bank select', 1: 'Modulation', 7: 'Volume', 10: 'Pan', 11: 'Expression',
  32: 'Bank select LSB', 64: 'Sustain pedal', 66: 'Sostenuto', 67: 'Soft pedal',
  91: 'Reverb', 93: 'Chorus', 121: 'Reset controllers', 123: 'All notes off',
};
