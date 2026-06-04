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
  scaleIntervals?: number[]; // e.g. [0, 2, 4, 5, 7, 9, 11] for major
  timeSignature?: { numerator: number; denominator: number };
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
  let section = `\n\nSong context (match this unless the prompt specifies otherwise):\n- Tempo: ${Math.round(ctx.tempo)} BPM\n- Key: ${key}`;
  if (ctx.timeSignature) {
    section += `\n- Time signature: ${ctx.timeSignature.numerator}/${ctx.timeSignature.denominator}`;
  }
  if (ctx.scaleIntervals && ctx.scaleIntervals.length > 0) {
    section += `\n- Scale intervals (semitones from root): [${ctx.scaleIntervals.join(", ")}]`;
  }
  return section;
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

// Three hand-crafted reference examples demonstrating the quality and detail expected.
// Velocities are intentionally varied; rhythms are idiomatically correct per genre.
const FEW_SHOT_EXAMPLES = `

QUALITY REFERENCE EXAMPLES — study these before generating; match this level of musicality:

[EXAMPLE 1 · Boom-bap hip-hop drum loop · 1 bar · Impulse]
Prompt: "1-bar boom-bap hip-hop drum loop, kick and snare backbone, ghost snares, swung open-hat accent"
{"notes":[{"pitch":36,"startTime":0,"duration":0.25,"velocity":112},{"pitch":42,"startTime":0,"duration":0.25,"velocity":72},{"pitch":42,"startTime":0.5,"duration":0.25,"velocity":58},{"pitch":38,"startTime":1,"duration":0.25,"velocity":108},{"pitch":42,"startTime":1,"duration":0.25,"velocity":65},{"pitch":38,"startTime":1.25,"duration":0.25,"velocity":32},{"pitch":42,"startTime":1.5,"duration":0.25,"velocity":52},{"pitch":36,"startTime":1.75,"duration":0.25,"velocity":82},{"pitch":42,"startTime":2,"duration":0.25,"velocity":70},{"pitch":46,"startTime":2.75,"duration":0.25,"velocity":78},{"pitch":38,"startTime":3,"duration":0.25,"velocity":105},{"pitch":42,"startTime":3,"duration":0.25,"velocity":55},{"pitch":38,"startTime":3.25,"duration":0.25,"velocity":30},{"pitch":36,"startTime":3.5,"duration":0.25,"velocity":75},{"pitch":42,"startTime":3.5,"duration":0.25,"velocity":62},{"pitch":42,"startTime":3.75,"duration":0.25,"velocity":48}],"clipLength":4}
What makes it authentic: kick on 1 and the "and" of 3 (syncopated boom-bap placement); snare ghosted on the "e" of beat 2 (vel 32) and "e" of beat 4 (vel 30); open hat on the "ah" of beat 2 as a breath; hi-hats alternate 72/58/65/52 — never uniform.

[EXAMPLE 2 · Funk bassline · C minor · 2 bars · Analog]
Prompt: "2-bar funk bass in C minor, 16th-note grid, syncopated, ghost notes, octave leaps, chromatic approach tones"
{"notes":[{"pitch":36,"startTime":0,"duration":0.25,"velocity":105},{"pitch":36,"startTime":0.5,"duration":0.25,"velocity":28},{"pitch":39,"startTime":0.75,"duration":0.25,"velocity":90},{"pitch":41,"startTime":1,"duration":0.5,"velocity":98},{"pitch":43,"startTime":1.5,"duration":0.25,"velocity":85},{"pitch":43,"startTime":1.75,"duration":0.25,"velocity":30},{"pitch":48,"startTime":2,"duration":0.25,"velocity":102},{"pitch":46,"startTime":2.5,"duration":0.25,"velocity":88},{"pitch":44,"startTime":2.75,"duration":0.25,"velocity":80},{"pitch":43,"startTime":3,"duration":0.5,"velocity":95},{"pitch":41,"startTime":3.5,"duration":0.25,"velocity":72},{"pitch":39,"startTime":3.75,"duration":0.25,"velocity":88},{"pitch":36,"startTime":4,"duration":0.5,"velocity":100},{"pitch":36,"startTime":4.75,"duration":0.25,"velocity":25},{"pitch":41,"startTime":5,"duration":0.25,"velocity":92},{"pitch":43,"startTime":5.25,"duration":0.25,"velocity":30},{"pitch":43,"startTime":5.5,"duration":0.25,"velocity":85},{"pitch":44,"startTime":5.75,"duration":0.25,"velocity":82},{"pitch":41,"startTime":6,"duration":0.5,"velocity":95},{"pitch":41,"startTime":6.5,"duration":0.25,"velocity":28},{"pitch":39,"startTime":6.75,"duration":0.25,"velocity":80},{"pitch":36,"startTime":7,"duration":0.25,"velocity":92},{"pitch":48,"startTime":7.25,"duration":0.25,"velocity":88},{"pitch":46,"startTime":7.5,"duration":0.25,"velocity":75},{"pitch":44,"startTime":7.75,"duration":0.25,"velocity":90}],"clipLength":8}
What makes it authentic: root C1(36) lands on beat 1 strong (vel 105); ghost C1 on the "and" of 1 (vel 28) adds pocket; Eb(39)→F(41) is a chromatic half-step approach; octave jump to C2(48) at beat 2 creates lift; Ab(44) is a chromatic passing tone between G(43) and G; bar 2 varies the pattern to avoid repetition; final four notes walk chromatically back to root for seamless loop.

[EXAMPLE 3 · Expressive lead melody · D natural minor · 4 bars · Wavetable]
Prompt: "4-bar lead melody in D natural minor, pentatonic runs with passing tones, rising arc in bars 1–2, climax in bar 3, resolve to root in bar 4"
{"notes":[{"pitch":62,"startTime":0,"duration":0.5,"velocity":88},{"pitch":65,"startTime":0.5,"duration":0.5,"velocity":75},{"pitch":67,"startTime":1,"duration":0.5,"velocity":92},{"pitch":69,"startTime":1.5,"duration":0.5,"velocity":82},{"pitch":72,"startTime":2,"duration":0.75,"velocity":105},{"pitch":69,"startTime":2.75,"duration":0.25,"velocity":80},{"pitch":67,"startTime":3,"duration":0.5,"velocity":88},{"pitch":65,"startTime":3.75,"duration":0.25,"velocity":72},{"pitch":62,"startTime":4.5,"duration":0.5,"velocity":85},{"pitch":65,"startTime":5,"duration":0.5,"velocity":78},{"pitch":67,"startTime":5.5,"duration":0.5,"velocity":95},{"pitch":69,"startTime":6,"duration":0.5,"velocity":88},{"pitch":67,"startTime":6.5,"duration":0.25,"velocity":72},{"pitch":65,"startTime":7,"duration":0.5,"velocity":80},{"pitch":62,"startTime":7.5,"duration":0.5,"velocity":68},{"pitch":67,"startTime":8.5,"duration":0.5,"velocity":92},{"pitch":69,"startTime":9,"duration":0.5,"velocity":88},{"pitch":72,"startTime":9.5,"duration":0.25,"velocity":100},{"pitch":74,"startTime":9.75,"duration":0.25,"velocity":110},{"pitch":72,"startTime":10,"duration":0.5,"velocity":90},{"pitch":69,"startTime":10.5,"duration":0.5,"velocity":80},{"pitch":67,"startTime":11,"duration":0.5,"velocity":85},{"pitch":65,"startTime":11.5,"duration":0.5,"velocity":75},{"pitch":64,"startTime":12,"duration":0.5,"velocity":88},{"pitch":65,"startTime":12.5,"duration":0.5,"velocity":82},{"pitch":67,"startTime":13,"duration":0.5,"velocity":92},{"pitch":69,"startTime":13.5,"duration":0.25,"velocity":78},{"pitch":62,"startTime":14,"duration":2,"velocity":105}],"clipLength":16}
What makes it authentic: rests in bars 1–2 (no note at beat 0.25, gap at beat 4–4.5) let the phrase breathe; C5(72) on the downbeat of bar 2 is the phrase peak; bar 3 reaches D5(74) — the highest note — on the "ah" of beat 2 (vel 110) for maximum tension; E(64) in bar 4 is a diatonic passing tone into the cadential descent; final D4(62) lands with a 2-beat sustain to anchor the loop.`;

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
  options?: {
    suggestInstrument?: boolean;
    songContext?: SongContext;
    refinement?: RefinementContext;
    sessionContext?: string;
  }
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
        SYSTEM_PROMPT +
        FEW_SHOT_EXAMPLES +
        (options?.suggestInstrument ? INSTRUMENT_ADDENDUM : "") +
        (options?.songContext ? buildSongContextSection(options.songContext) : "") +
        (options?.sessionContext
          ? `\n\nSession context (existing tracks — generate something that complements these):\n${options.sessionContext}`
          : ""),
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
