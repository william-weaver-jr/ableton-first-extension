import { describe, expect, it } from "vitest";
import { buildSessionContext, type SongLike } from "./sessionContext.js";

function makeSong(tracks: SongLike["tracks"] = [], scenes: SongLike["scenes"] = []): SongLike {
  return { tracks, scenes };
}

function midiTrack(
  name: string,
  devices: string[] = [],
  clips: Array<{ name: string; duration: number; pitches: number[] }> = []
) {
  return {
    name,
    devices: devices.map((d) => ({ name: d })),
    arrangementClips: clips.map((c) => ({
      name: c.name,
      duration: c.duration,
      notes: c.pitches.map((p) => ({ pitch: p, startTime: 0, duration: 0.5, velocity: 80 })),
    })),
  };
}

function audioTrack(name: string, devices: string[] = []) {
  return {
    name,
    devices: devices.map((d) => ({ name: d })),
    arrangementClips: [],
  };
}

describe("buildSessionContext", () => {
  it("returns empty string for a song with no tracks", () => {
    expect(buildSessionContext(makeSong())).toBe("");
  });

  it("includes track name and device names", () => {
    const song = makeSong([midiTrack("Bass", ["Analog"])]);
    const result = buildSessionContext(song);
    expect(result).toContain("Bass");
    expect(result).toContain("Analog");
  });

  it("shows [no device] when track has no devices", () => {
    const song = makeSong([midiTrack("Empty Track")]);
    expect(buildSessionContext(song)).toContain("[no device]");
  });

  it("summarizes MIDI clip with name, bars, note count, pitch range", () => {
    const song = makeSong([
      midiTrack("Bass", ["Analog"], [{ name: "groove", duration: 8, pitches: [36, 40, 43] }]),
    ]);
    const result = buildSessionContext(song);
    expect(result).toContain('"groove"');
    expect(result).toContain("2bar"); // 8 beats / 4 = 2 bars
    expect(result).toContain("3n");   // 3 notes
    // pitch range: 36 (C1) to 43 (G1)
    expect(result).toContain("C1");
    expect(result).toContain("G1");
  });

  it("handles clips with no notes (empty MIDI clip)", () => {
    const song = makeSong([
      midiTrack("Empty Clip Track", [], [{ name: "empty", duration: 4, pitches: [] }]),
    ]);
    const result = buildSessionContext(song);
    expect(result).toContain("empty");
    expect(result).toContain("0n");
  });

  it("skips clip note range for audio tracks (no .notes property)", () => {
    const song = makeSong([audioTrack("Kick", ["Compressor"])]);
    const result = buildSessionContext(song);
    expect(result).toContain("Kick");
    expect(result).toContain("Compressor");
    // No clip summaries since audio clips have no .notes
    expect(result).not.toContain("bar");
  });

  it("respects maxTracks cap", () => {
    const tracks = Array.from({ length: 15 }, (_, i) => midiTrack(`Track ${i + 1}`));
    const result = buildSessionContext(makeSong(tracks), { maxTracks: 5 });
    expect(result).toContain("5 track(s)");
    expect(result).not.toContain("Track 6");
  });

  it("respects maxClipsPerTrack cap", () => {
    const clips = Array.from({ length: 6 }, (_, i) => ({
      name: `clip${i + 1}`,
      duration: 4,
      pitches: [60],
    }));
    const song = makeSong([midiTrack("Track", [], clips)]);
    const result = buildSessionContext(song, { maxClipsPerTrack: 2 });
    expect(result).toContain("clip1");
    expect(result).toContain("clip2");
    expect(result).not.toContain("clip3");
  });

  it("includes time signature from first scene", () => {
    const song = makeSong(
      [midiTrack("Bass")],
      [{ signatureNumerator: 3, signatureDenominator: 4 }]
    );
    const result = buildSessionContext(song);
    expect(result).toContain("3/4");
  });

  it("omits time signature when no scenes exist", () => {
    const song = makeSong([midiTrack("Bass")]);
    const result = buildSessionContext(song);
    expect(result).not.toContain("time sig");
  });

  it("does not throw when a track is malformed", () => {
    const brokenTrack = null as unknown as SongLike["tracks"][0];
    const song = makeSong([brokenTrack, midiTrack("Good Track", ["Operator"])]);
    expect(() => buildSessionContext(song)).not.toThrow();
    expect(buildSessionContext(song)).toContain("Good Track");
  });

  it("shows track count in output header", () => {
    const song = makeSong([midiTrack("A"), midiTrack("B"), midiTrack("C")]);
    expect(buildSessionContext(song)).toContain("3 track(s)");
  });
});
