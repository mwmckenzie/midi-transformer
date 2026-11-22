import type { VoiceStats } from './voices';

export type HandRole = 'right' | 'left' | 'both' | 'other' | 'drums';

export interface VoiceGuess {
  voiceId: string;
  role: HandRole;
  /** 0..1 */
  confidence: number;
  reasons: string[];
}

export interface HandDetection {
  guesses: VoiceGuess[];
  right: string | null;
  left: string | null;
  /** Voices that look like they hold both hands and should be run through a split algorithm. */
  combined: string[];
  summary: string;
}

const RIGHT_NAME = /\b(right|r\.?\s?h\.?|treble|upper|melody|rechte?|droite|destra)\b/i;
const LEFT_NAME = /\b(left|l\.?\s?h\.?|bass|lower|linke?|gauche|sinistra)\b/i;
const MIN_NOTES = 8;

const isKeyboard = (p: number | undefined) => p === undefined || p <= 7 || (p >= 16 && p <= 20);

/**
 * Heuristic hand detection. Scores each (track, channel) voice and suggests which voice is the
 * right hand, which is the left, and which seem to contain both hands at once.
 * The scoring is deliberately transparent: every guess carries the reasons behind it.
 */
export function detectHands(stats: VoiceStats[]): HandDetection {
  const guesses: VoiceGuess[] = [];
  const candidates: VoiceStats[] = [];

  for (const s of stats) {
    if (s.channel === 9) {
      guesses.push({ voiceId: s.id, role: 'drums', confidence: 0.95, reasons: ['Channel 9 is the GM drum channel'] });
      continue;
    }
    if (s.noteCount < MIN_NOTES) {
      guesses.push({ voiceId: s.id, role: 'other', confidence: 0.5, reasons: [`Only ${s.noteCount} notes`] });
      continue;
    }
    const reasons: string[] = [];
    let both = 0;
    const range = s.p90 - s.p10;
    if (s.wideSpanRatio > 0.15) {
      both += Math.min(0.5, s.wideSpanRatio * 1.2);
      reasons.push(`${Math.round(s.wideSpanRatio * 100)}% of onsets span more than one hand can reach`);
    }
    if (range >= 28) {
      both += Math.min(0.3, (range - 24) / 40);
      reasons.push(`Wide core range (${range} semitones between 10th and 90th percentile)`);
    }
    if (s.histogramGap >= 4) {
      both += Math.min(0.2, s.histogramGap / 30);
      reasons.push(`Pitch histogram has a ${s.histogramGap}-semitone hole, suggesting two registers`);
    }
    if (s.avgPolyphony >= 2.5) {
      both += 0.1;
      reasons.push(`Dense texture (avg ${s.avgPolyphony.toFixed(1)} notes sounding)`);
    }
    if (RIGHT_NAME.test(s.trackName) || LEFT_NAME.test(s.trackName)) both -= 0.4;
    if (both >= 0.45) {
      guesses.push({ voiceId: s.id, role: 'both', confidence: Math.min(0.95, both), reasons });
    } else {
      candidates.push(s);
    }
  }

  // Name-based hints are the strongest single signal for separate-hand files.
  let right = candidates.find((s) => RIGHT_NAME.test(s.trackName) && !LEFT_NAME.test(s.trackName)) ?? null;
  let left = candidates.find((s) => LEFT_NAME.test(s.trackName) && s !== right) ?? null;
  const named = new Set([right?.id, left?.id]);

  // Otherwise pick the highest and lowest keyboard voices by median pitch.
  const pool = candidates.filter((s) => isKeyboard(s.program));
  const ranked = (pool.length >= 2 ? pool : candidates).slice().sort((a, b) => b.medianPitch - a.medianPitch);
  if (!right && ranked.length) right = ranked.find((s) => s !== left) ?? null;
  if (!left && ranked.length >= 2) left = [...ranked].reverse().find((s) => s !== right) ?? null;
  if (right && left && right.medianPitch < left.medianPitch && !named.has(right.id) && !named.has(left.id))
    [right, left] = [left, right];

  for (const s of candidates) {
    const reasons: string[] = [];
    let role: HandRole = 'other';
    let conf = 0.3;
    if (s === right || s === left) {
      role = s === right ? 'right' : 'left';
      const other = s === right ? left : right;
      if (named.has(s.id)) {
        reasons.push(`Track name "${s.trackName}" suggests the ${role} hand`);
        conf = 0.85;
      }
      if (other) {
        const sep = Math.abs(s.medianPitch - other.medianPitch);
        reasons.push(`Median pitch ${s.medianPitch} vs ${other.medianPitch} for the other hand (${sep} semitones apart)`);
        conf = Math.max(conf, Math.min(0.9, 0.4 + sep / 30));
      } else {
        reasons.push('Only one keyboard voice found');
      }
      if (!isKeyboard(s.program)) {
        reasons.push('Not a keyboard instrument');
        conf *= 0.7;
      }
    } else {
      reasons.push('Not selected as either hand');
    }
    guesses.push({ voiceId: s.id, role, confidence: conf, reasons });
  }

  const combined = guesses.filter((g) => g.role === 'both').map((g) => g.voiceId);
  let summary: string;
  if (right && left) summary = `Separate hands likely: right = ${right.id}, left = ${left.id}.`;
  else if (combined.length) summary = `Both hands appear to share ${combined.join(', ')}. Try a split algorithm.`;
  else if (right) summary = `Only one playable voice (${right.id}). It may need splitting.`;
  else summary = 'No piano-like voices found.';
  if (right && left && combined.length) summary += ` Also, ${combined.join(', ')} looks two-handed.`;

  const order = (g: VoiceGuess) => stats.findIndex((s) => s.id === g.voiceId);
  guesses.sort((a, b) => order(a) - order(b));
  return { guesses, right: right?.id ?? null, left: left?.id ?? null, combined, summary };
}
