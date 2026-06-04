import type { NoteDescription } from "@ableton-extensions/sdk";

export interface GeneratedMidi {
  notes: NoteDescription[];
  clipLength: number;
  instrument?: { name: string };
}

export interface SongContext {
  tempo: number;
  rootNote: number; // 0–11, C = 0
  scaleName: string;
}

export const KNOWN_INSTRUMENTS = [
  "Operator", "Wavetable", "Analog", "Electric",
  "Simpler", "Impulse", "Drift", "Meld", "Tension", "Collision",
] as const;

/** Returns the instrument name if the user explicitly named one in their prompt, otherwise undefined. */
export function detectUserSpecifiedInstrument(prompt: string): string | undefined {
  const lower = prompt.toLowerCase();
  return KNOWN_INSTRUMENTS.find((name) =>
    new RegExp(`\\b${name.toLowerCase()}\\b`).test(lower)
  );
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function buildSongContextSection(ctx: SongContext): string {
  const noteName = NOTE_NAMES[ctx.rootNote % 12] ?? "C";
  const key = ctx.scaleName ? `${noteName} ${ctx.scaleName}` : noteName;
  return `\n\nSong context (match this unless the prompt specifies otherwise):\n- Tempo: ${Math.round(ctx.tempo)} BPM\n- Key: ${key}`;
}

const SYSTEM_PROMPT = `You are a MIDI composition assistant. Given a text description, generate a MIDI clip as JSON.

Return ONLY valid JSON — no explanation, no markdown fences, just the raw JSON object:
{
  "notes": [
    { "pitch": <0-127>, "startTime": <beats>, "duration": <beats>, "velocity": <0-127> }
  ],
  "clipLength": <total clip length in beats>
}

Rules:
- pitch: MIDI note number (C4 = middle C = 60; one octave = 12 semitones)
- startTime: beat position from 0, where 1 beat = one quarter note at any tempo
- duration: length in beats (0.25 = 16th, 0.5 = 8th, 1 = quarter, 2 = half, 4 = whole)
- velocity: 1-127, typically 60-100 for musical notes; vary it for expression
- clipLength: total length in beats, typically a multiple of 4 (4 = 1 bar, 16 = 4 bars)
- Notes must not start after clipLength; notes may extend slightly past it
- Produce musically coherent, rhythmically tight content that matches the description
- When a scale or key is not specified, use a musically reasonable default`;

const INSTRUMENT_ADDENDUM = `

Also include an "instrument" field with the best Ableton built-in instrument for this sound:
{ "instrument": { "name": "<device name>" } }

Choose exactly one from this list (use exact spelling):
Operator, Wavetable, Analog, Electric, Simpler, Impulse, Drift, Meld, Tension, Collision

Guidelines:
- Leads / pads / arps / chords: Wavetable or Operator
- FM, metallic, or percussive tones: Operator
- Warm analog bass or lead: Analog or Meld
- Electric piano or keys: Electric
- Acoustic plucked strings, mallets: Tension or Collision
- Drum patterns / percussion: Impulse
- Modern evolving textures: Drift or Wavetable`;

export async function generateMidiFromPrompt(
  prompt: string,
  options?: { suggestInstrument?: boolean; songContext?: SongContext }
): Promise<GeneratedMidi> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to your .env file."
    );
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system:
        (options?.suggestInstrument ? SYSTEM_PROMPT + INSTRUMENT_ADDENDUM : SYSTEM_PROMPT) +
        (options?.songContext ? buildSongContextSection(options.songContext) : ""),
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Claude API error ${response.status}: ${body}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
  };

  const text = data.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("No text content in Claude API response");

  let parsed: GeneratedMidi;
  try {
    parsed = JSON.parse(text) as GeneratedMidi;
  } catch {
    throw new Error(`Claude returned invalid JSON:\n${text}`);
  }

  if (!Array.isArray(parsed.notes) || typeof parsed.clipLength !== "number") {
    throw new Error("Claude response is missing required fields");
  }

  return parsed;
}
