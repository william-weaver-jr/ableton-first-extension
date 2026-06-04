import type { NoteDescription } from "@ableton-extensions/sdk";

/**
 * Snaps any out-of-scale notes to the nearest in-scale pitch.
 * Notes already in scale are returned unchanged.
 * When two scale degrees are equidistant, the lower one is preferred.
 * Caller should gate on song.scaleMode before calling — this does not check it.
 */
export function snapToScale(
  notes: NoteDescription[],
  scaleIntervals: number[],
  rootNote: number
): NoteDescription[] {
  if (scaleIntervals.length === 0) return notes;

  return notes.map((note) => {
    const pitchClass = ((note.pitch - rootNote) % 12 + 12) % 12;
    if (scaleIntervals.includes(pitchClass)) return note;

    let bestDelta = 0;
    let bestDist = Infinity;

    for (const interval of scaleIntervals) {
      // Compute the shortest signed delta from pitchClass to this interval, wrapped to [-6, 6]
      let delta = ((interval - pitchClass) + 12) % 12;
      if (delta > 6) delta -= 12;
      const dist = Math.abs(delta);
      // Prefer closer; break ties by going down (delta < 0)
      if (dist < bestDist || (dist === bestDist && delta < bestDelta)) {
        bestDist = dist;
        bestDelta = delta;
      }
    }

    const newPitch = Math.max(0, Math.min(127, note.pitch + bestDelta));
    return { ...note, pitch: newPitch };
  });
}
