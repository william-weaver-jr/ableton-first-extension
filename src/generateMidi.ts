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

export interface RefinementContext {
  notes: NoteDescription[];
  clipLength: number;
  originalPrompt?: string; // clip name used as the original user turn
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

const SYSTEM_PROMPT = `You are an expert MIDI composer creating clips for Ableton Live. Musical quality is the top priority — every clip must sound like something a skilled musician actually played, not a mechanical exercise.

Return ONLY valid JSON with no explanation, no markdown, no preamble:
{
  "notes": [
    { "pitch": <0-127>, "startTime": <beats>, "duration": <beats>, "velocity": <1-127> }
  ],
  "clipLength": <total clip length in beats>
}

Technical format:
- pitch: MIDI note number (C4 = middle C = 60; one octave = 12 semitones)
- startTime: beat position from 0 (1 beat = one quarter note)
- duration: in beats — 0.25 = 16th note, 0.5 = 8th, 1 = quarter, 2 = half, 4 = whole
- clipLength: loop length in beats, must be a power-of-2 bar multiple (4, 8, 16, or 32)
- No note may start at or after clipLength

Composition standards:
- Scale and harmony: identify the appropriate key and mode; use chord tones on strong beats, passing and approach tones on weak beats
- Velocity shaping: accents 95–115, normal notes 65–85, ghost notes / grace notes 25–45 — uniform velocity sounds robotic and must be avoided
- Rhythm: match density and syncopation to genre (funk = sparse + syncopated; house = tight 16ths; jazz = swung 8ths; classical = lyrical phrasing; EDM = grid-locked)
- Phrasing: shape melodic lines with direction and contour, not random scale degrees
- Loop coherence: the clip must loop seamlessly — the last beat must resolve naturally back to beat 0
- Bass lines: root on beat 1, add movement through chromatic approaches, octave leaps, and chord-tone runs
- Drum patterns (Impulse): GM drum map — kick 36, snare 38, closed hi-hat 42, open hi-hat 46, ride 51, crash 49, low tom 41, mid tom 45, hi tom 48`;

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

function buildMessages(
  prompt: string,
  refinement?: RefinementContext
): Array<{ role: "user" | "assistant"; content: string }> {
  if (!refinement) return [{ role: "user", content: prompt }];

  const previousJson = JSON.stringify({
    notes: refinement.notes.map((n) => ({
      pitch: n.pitch,
      startTime: n.startTime,
      duration: n.duration,
      velocity: n.velocity ?? 80,
    })),
    clipLength: refinement.clipLength,
  });

  return [
    { role: "user", content: refinement.originalPrompt ?? "Generate a MIDI clip" },
    { role: "assistant", content: previousJson },
    { role: "user", content: prompt },
  ];
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
  if (fenced) return fenced[1]!;
  const bare = text.match(/(\{[\s\S]*\})/);
  if (bare) return bare[1]!;
  return text;
}

export async function generateMidiFromPrompt(
  prompt: string,
  options?: { suggestInstrument?: boolean; songContext?: SongContext; refinement?: RefinementContext }
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
      max_tokens: 16000,
      thinking: {
        type: "enabled",
        budget_tokens: 8000,
      },
      system:
        (options?.suggestInstrument ? SYSTEM_PROMPT + INSTRUMENT_ADDENDUM : SYSTEM_PROMPT) +
        (options?.songContext ? buildSongContextSection(options.songContext) : ""),
      messages: buildMessages(prompt, options?.refinement),
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

  const jsonText = extractJson(text);
  let parsed: GeneratedMidi;
  try {
    parsed = JSON.parse(jsonText) as GeneratedMidi;
  } catch {
    throw new Error(`Claude returned invalid JSON:\n${text}`);
  }

  if (!Array.isArray(parsed.notes) || typeof parsed.clipLength !== "number") {
    throw new Error("Claude response is missing required fields");
  }

  return parsed;
}
