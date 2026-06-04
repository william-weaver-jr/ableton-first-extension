import { describe, expect, it } from "vitest";
import { snapToScale } from "./snapToScale.js";
import type { NoteDescription } from "@ableton-extensions/sdk";

const MAJOR = [0, 2, 4, 5, 7, 9, 11];       // C major
const MINOR = [0, 2, 3, 5, 7, 8, 10];        // natural minor
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const PENTATONIC = [0, 2, 4, 7, 9];           // major pentatonic

function note(pitch: number): NoteDescription {
  return { pitch, startTime: 0, duration: 1, velocity: 80 };
}

describe("snapToScale", () => {
  it("returns notes unchanged when scaleIntervals is empty", () => {
    const notes = [note(61)]; // C#
    expect(snapToScale(notes, [], 0)).toEqual(notes);
  });

  it("returns notes unchanged when they are already in scale", () => {
    const notes = [note(60), note(62), note(64)]; // C D E — all in C major
    const result = snapToScale(notes, MAJOR, 0);
    expect(result.map((n) => n.pitch)).toEqual([60, 62, 64]);
  });

  it("snaps C# (61) to C (60) in C major — nearest is C, tie goes down", () => {
    expect(snapToScale([note(61)], MAJOR, 0)[0]!.pitch).toBe(60);
  });

  it("snaps D# (63) to D (62) in C major — equidistant, tie-break goes down", () => {
    expect(snapToScale([note(63)], MAJOR, 0)[0]!.pitch).toBe(62);
  });

  it("snaps A# (70) to A (69) in C major — tie goes down", () => {
    expect(snapToScale([note(70)], MAJOR, 0)[0]!.pitch).toBe(69);
  });

  it("preserves octave — snaps across the full MIDI range", () => {
    // C#5 = 73; nearest in C major is C5 = 72
    expect(snapToScale([note(73)], MAJOR, 0)[0]!.pitch).toBe(72);
    // C#2 = 25; nearest is C2 = 24
    expect(snapToScale([note(25)], MAJOR, 0)[0]!.pitch).toBe(24);
  });

  it("preserves all other NoteDescription fields", () => {
    const n: NoteDescription = { pitch: 61, startTime: 2, duration: 0.5, velocity: 90, muted: false };
    const result = snapToScale([n], MAJOR, 0)[0]!;
    expect(result.startTime).toBe(2);
    expect(result.duration).toBe(0.5);
    expect(result.velocity).toBe(90);
    expect(result.muted).toBe(false);
  });

  it("handles non-zero rootNote — C# major (rootNote=1)", () => {
    // C# major intervals: [0,2,4,5,7,9,11] starting at C# (1)
    // D=2 is in scale (root+1=2); C=0 is not
    const result = snapToScale([note(60)], MAJOR, 1); // C4=60, not in C# major
    // pitchClass of C relative to C# root: (60-1+120)%12 = 11, not in MAJOR
    // nearest: 11 is in MAJOR (B, the major 7th), delta=0... wait
    // Actually scaleIntervals=[0,2,4,5,7,9,11], rootNote=1
    // pitchClass = (60-1+120)%12 = (59+120)%12 = 179%12 = 11
    // 11 IS in MAJOR → note stays at 60
    expect(result[0]!.pitch).toBe(60);
  });

  it("clamps pitch to MIDI range [0, 127]", () => {
    // pitch 0 (C-2) with root C, if it needed to go down it stays at 0
    const result = snapToScale([note(1)], MAJOR, 0); // C#-2=1, snaps down to C-2=0
    expect(result[0]!.pitch).toBe(0);
  });

  it("works with pentatonic scale", () => {
    // C pentatonic: C D E G A (0,2,4,7,9)
    // F=5 not in pentatonic; nearest: E=4 (dist 1) and G=7 (dist 2) → E wins
    expect(snapToScale([note(65)], PENTATONIC, 0)[0]!.pitch).toBe(64);
    // B=11 not in pentatonic; nearest: A=9 (dist 2) and C=12→0 (dist 1) → C wins
    // C in next octave is dist 1 up: pitch 71+1=72
    expect(snapToScale([note(71)], PENTATONIC, 0)[0]!.pitch).toBe(72);
  });

  it("handles Dorian mode correctly", () => {
    // D Dorian (rootNote=2): intervals [0,2,3,5,7,9,10]
    // E = pitch 64, pitchClass relative to D: (64-2+120)%12 = 2 — IS in Dorian (major 2nd)
    expect(snapToScale([note(64)], DORIAN, 2)[0]!.pitch).toBe(64);
    // F# = pitch 66, pitchClass: (66-2)%12=4, not in [0,2,3,5,7,9,10]
    // nearest: 3 (Eb, dist 1) and 5 (G, dist 1) — tie goes down (3 < 5, delta=-1)
    expect(snapToScale([note(66)], DORIAN, 2)[0]!.pitch).toBe(65);
  });

  it("handles all 12 root notes without throwing", () => {
    for (let root = 0; root < 12; root++) {
      expect(() => snapToScale([note(60)], MAJOR, root)).not.toThrow();
    }
  });

  it("handles an empty notes array", () => {
    expect(snapToScale([], MAJOR, 0)).toEqual([]);
  });
});
