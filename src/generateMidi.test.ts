import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSongContextSection,
  detectUserSpecifiedInstrument,
  generateMidiFromPrompt,
  KNOWN_INSTRUMENTS,
  type RefinementContext,
  type SongContext,
} from "./generateMidi.js";

// ---------------------------------------------------------------------------
// detectUserSpecifiedInstrument
// ---------------------------------------------------------------------------

describe("detectUserSpecifiedInstrument", () => {
  it("detects an instrument named at the end of a prompt", () => {
    expect(detectUserSpecifiedInstrument("FM bass with Operator")).toBe("Operator");
  });

  it("detects an instrument named at the start of a prompt", () => {
    expect(detectUserSpecifiedInstrument("Wavetable pad, slow attack, lush reverb")).toBe("Wavetable");
  });

  it("is case-insensitive", () => {
    expect(detectUserSpecifiedInstrument("analog warmth, deep sub bass")).toBe("Analog");
    expect(detectUserSpecifiedInstrument("IMPULSE kick pattern")).toBe("Impulse");
  });

  it("returns undefined when no known instrument is mentioned", () => {
    expect(detectUserSpecifiedInstrument("funky bassline in C minor, syncopated 16ths")).toBeUndefined();
    expect(detectUserSpecifiedInstrument("")).toBeUndefined();
  });

  it("does not match partial words (simple ≠ Simpler)", () => {
    expect(detectUserSpecifiedInstrument("a simple groove")).toBeUndefined();
    expect(detectUserSpecifiedInstrument("operate at high tempo")).toBeUndefined();
  });

  it("detects every known instrument", () => {
    for (const name of KNOWN_INSTRUMENTS) {
      expect(detectUserSpecifiedInstrument(`use ${name} for this`)).toBe(name);
    }
  });
});

// ---------------------------------------------------------------------------
// buildSongContextSection
// ---------------------------------------------------------------------------

describe("buildSongContextSection", () => {
  it("formats tempo (rounded) and key correctly", () => {
    const ctx: SongContext = { tempo: 120.7, rootNote: 0, scaleName: "Minor" };
    const result = buildSongContextSection(ctx);
    expect(result).toContain("Tempo: 121 BPM");
    expect(result).toContain("Key: C Minor");
  });

  it("handles all 12 root note names", () => {
    const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    for (let i = 0; i < 12; i++) {
      const result = buildSongContextSection({ tempo: 120, rootNote: i, scaleName: "Major" });
      expect(result).toContain(`Key: ${names[i]}`);
    }
  });

  it("omits scale name when empty", () => {
    const result = buildSongContextSection({ tempo: 120, rootNote: 5, scaleName: "" });
    expect(result).toContain("Key: F");
    expect(result).not.toMatch(/Key: F\s/); // no trailing space before newline
  });

  it("wraps rootNote values beyond 11 safely", () => {
    const result = buildSongContextSection({ tempo: 100, rootNote: 12, scaleName: "Major" });
    expect(result).toContain("Key: C Major"); // 12 % 12 = 0 → C
  });
});

// ---------------------------------------------------------------------------
// generateMidiFromPrompt
// ---------------------------------------------------------------------------

function makeFetchResponse(text: string, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 400,
    text: async () => text,
    json: async () => ({ content: [{ type: "text", text }] }),
  } as unknown as Response;
}

describe("generateMidiFromPrompt", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("parses a valid minimal response", async () => {
    const payload = JSON.stringify({
      notes: [{ pitch: 60, startTime: 0, duration: 1, velocity: 80 }],
      clipLength: 4,
    });
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(payload));

    const result = await generateMidiFromPrompt("test prompt");
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]!.pitch).toBe(60);
    expect(result.clipLength).toBe(4);
    expect(result.instrument).toBeUndefined();
  });

  it("includes instrument field when suggestInstrument is true", async () => {
    const payload = JSON.stringify({
      notes: [{ pitch: 48, startTime: 0, duration: 0.5, velocity: 90 }],
      clipLength: 4,
      instrument: { name: "Analog" },
    });
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(payload));

    const result = await generateMidiFromPrompt("warm bassline", { suggestInstrument: true });
    expect(result.instrument?.name).toBe("Analog");
  });

  it("throws on invalid JSON from Claude", async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse("not valid json"));
    await expect(generateMidiFromPrompt("test")).rejects.toThrow("invalid JSON");
  });

  it("throws when notes field is missing", async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(JSON.stringify({ clipLength: 4 })));
    await expect(generateMidiFromPrompt("test")).rejects.toThrow("missing required fields");
  });

  it("throws when clipLength field is missing", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeFetchResponse(JSON.stringify({ notes: [] }))
    );
    await expect(generateMidiFromPrompt("test")).rejects.toThrow("missing required fields");
  });

  it("throws when ANTHROPIC_API_KEY is not set", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(generateMidiFromPrompt("test")).rejects.toThrow("ANTHROPIC_API_KEY");
  });

  it("throws on a non-ok API response", async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse("Bad Request", false));
    await expect(generateMidiFromPrompt("test")).rejects.toThrow("Claude API error 400");
  });

  it("appends song context to system prompt when provided", async () => {
    const payload = JSON.stringify({
      notes: [{ pitch: 60, startTime: 0, duration: 1, velocity: 80 }],
      clipLength: 4,
    });
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(payload));

    await generateMidiFromPrompt("test", {
      songContext: { tempo: 130, rootNote: 9, scaleName: "Minor" },
    });

    const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string);
    expect(body.system).toContain("Tempo: 130 BPM");
    expect(body.system).toContain("Key: A Minor");
  });

  it("includes scaleIntervals and timeSignature in system prompt when provided", async () => {
    const payload = JSON.stringify({
      notes: [{ pitch: 60, startTime: 0, duration: 1, velocity: 80 }],
      clipLength: 4,
    });
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(payload));

    await generateMidiFromPrompt("test", {
      songContext: {
        tempo: 120,
        rootNote: 0,
        scaleName: "Major",
        scaleIntervals: [0, 2, 4, 5, 7, 9, 11],
        timeSignature: { numerator: 3, denominator: 4 },
      },
    });

    const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string);
    expect(body.system).toContain("Time signature: 3/4");
    expect(body.system).toContain("Scale intervals");
    expect(body.system).toContain("0, 2, 4, 5, 7, 9, 11");
  });

  it("includes few-shot examples in every request", async () => {
    const payload = JSON.stringify({
      notes: [{ pitch: 60, startTime: 0, duration: 1, velocity: 80 }],
      clipLength: 4,
    });
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(payload));

    await generateMidiFromPrompt("test prompt");

    const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string);
    expect(body.system).toContain("QUALITY REFERENCE EXAMPLES");
    expect(body.system).toContain("boom-bap");
    expect(body.system).toContain("funk bass");
    expect(body.system).toContain("lead melody");
  });

  it("appends session context to system prompt when provided", async () => {
    const payload = JSON.stringify({
      notes: [{ pitch: 60, startTime: 0, duration: 1, velocity: 80 }],
      clipLength: 4,
    });
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(payload));

    await generateMidiFromPrompt("test", {
      sessionContext: "2 track(s):\n  - Bass [Analog]\n  - Drums [Impulse]",
    });

    const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string);
    expect(body.system).toContain("Session context");
    expect(body.system).toContain("Bass [Analog]");
    expect(body.system).toContain("Drums [Impulse]");
  });

  it("sends extended thinking parameters in every request", async () => {
    const payload = JSON.stringify({
      notes: [{ pitch: 60, startTime: 0, duration: 1, velocity: 80 }],
      clipLength: 4,
    });
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(payload));

    await generateMidiFromPrompt("test prompt");

    const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string);
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 8000 });
    expect(body.max_tokens).toBeGreaterThan(body.thinking.budget_tokens);
  });

  it("sends a three-turn conversation when refinement context is provided", async () => {
    const payload = JSON.stringify({
      notes: [{ pitch: 62, startTime: 0, duration: 0.5, velocity: 90 }],
      clipLength: 8,
    });
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(payload));

    const refinement: RefinementContext = {
      notes: [{ pitch: 60, startTime: 0, duration: 1, velocity: 80 }],
      clipLength: 4,
      originalPrompt: "4-bar bassline",
    };
    await generateMidiFromPrompt("add more syncopation", { refinement });

    const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string);
    expect(body.messages).toHaveLength(3);
    expect(body.messages[0]).toMatchObject({ role: "user", content: "4-bar bassline" });
    expect(body.messages[1].role).toBe("assistant");
    const assistantJson = JSON.parse(body.messages[1].content);
    expect(assistantJson.clipLength).toBe(4);
    expect(assistantJson.notes[0].pitch).toBe(60);
    expect(body.messages[2]).toMatchObject({ role: "user", content: "add more syncopation" });
  });

  it("falls back to a generic first turn when originalPrompt is absent", async () => {
    const payload = JSON.stringify({ notes: [], clipLength: 4 });
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(payload));

    await generateMidiFromPrompt("slower", {
      refinement: { notes: [], clipLength: 4 },
    });

    const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string);
    expect(body.messages[0].content).toBe("Generate a MIDI clip");
  });

  it("parses JSON wrapped in markdown code fences, including nested objects", async () => {
    const jsonPayload = JSON.stringify({
      notes: [{ pitch: 60, startTime: 0, duration: 1, velocity: 80 }],
      clipLength: 4,
      instrument: { name: "Analog" },
    });
    const fenced = `Here is the MIDI clip:\n\`\`\`json\n${jsonPayload}\n\`\`\``;
    vi.mocked(fetch).mockResolvedValue({
      ok: true, status: 200,
      text: async () => "",
      json: async () => ({ content: [{ type: "text", text: fenced }] }),
    } as unknown as Response);

    const result = await generateMidiFromPrompt("R&B keys");
    expect(result.clipLength).toBe(4);
    expect(result.notes).toHaveLength(1);
    expect(result.instrument?.name).toBe("Analog");
  });

  it("extracts text block from a response that includes thinking blocks", async () => {
    const jsonPayload = JSON.stringify({
      notes: [{ pitch: 60, startTime: 0, duration: 1, velocity: 80 }],
      clipLength: 4,
    });
    // Simulate a response where the thinking block comes before the text block
    const responseWithThinking = {
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({
        content: [
          { type: "thinking", thinking: "Let me reason about this..." },
          { type: "text", text: jsonPayload },
        ],
      }),
    } as unknown as Response;
    vi.mocked(fetch).mockResolvedValue(responseWithThinking);

    const result = await generateMidiFromPrompt("test");
    expect(result.clipLength).toBe(4);
    expect(result.notes).toHaveLength(1);
  });
});
