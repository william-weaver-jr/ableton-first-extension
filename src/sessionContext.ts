import type { NoteDescription } from "@ableton-extensions/sdk";

// Duck-typed interface — matches the SDK's Song/Track/Clip shape without importing live classes
interface ClipLike {
  name: string;
  duration: number;
  notes?: NoteDescription[]; // only present on MidiClip
}

interface TrackLike {
  name: string;
  devices: Array<{ name: string }>;
  arrangementClips: ClipLike[];
}

interface SceneLike {
  signatureNumerator: number;
  signatureDenominator: number;
}

export interface SongLike {
  tracks: TrackLike[];
  scenes: SceneLike[];
}

// Ableton convention: MIDI 60 = C3
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function pitchToName(pitch: number): string {
  const name = NOTE_NAMES[pitch % 12] ?? "?";
  const octave = Math.floor(pitch / 12) - 2;
  return `${name}${octave}`;
}

export function buildSessionContext(
  song: SongLike,
  opts?: { maxTracks?: number; maxClipsPerTrack?: number }
): string {
  const maxTracks = opts?.maxTracks ?? 10;
  const maxClipsPerTrack = opts?.maxClipsPerTrack ?? 3;

  const tracks = song.tracks.slice(0, maxTracks);
  if (tracks.length === 0) return "";

  const lines: string[] = [];

  for (const track of tracks) {
    try {
      const deviceNames = track.devices.map((d) => d.name);
      const clips = track.arrangementClips.slice(0, maxClipsPerTrack);

      const clipDescs: string[] = [];
      for (const clip of clips) {
        try {
          if (Array.isArray(clip.notes)) {
            const bars = Math.max(1, Math.round(clip.duration / 4));
            const pitches = clip.notes.map((n) => n.pitch);
            const rangeStr =
              pitches.length > 0
                ? `${pitchToName(Math.min(...pitches))}–${pitchToName(Math.max(...pitches))}`
                : "empty";
            const label = clip.name ? `"${clip.name}"` : "untitled";
            clipDescs.push(`${label} ${bars}bar ${clip.notes.length}n ${rangeStr}`);
          }
        } catch {
          // skip unreadable clip
        }
      }

      const devStr = deviceNames.length > 0 ? `[${deviceNames.join(", ")}]` : "[no device]";
      const clipStr = clipDescs.length > 0 ? ` | ${clipDescs.join("; ")}` : "";
      lines.push(`  - ${track.name} ${devStr}${clipStr}`);
    } catch {
      // skip unreadable track
    }
  }

  if (lines.length === 0) return "";

  let timeSig = "";
  try {
    const scene = song.scenes[0];
    if (scene?.signatureNumerator && scene?.signatureDenominator) {
      timeSig = ` | time sig: ${scene.signatureNumerator}/${scene.signatureDenominator}`;
    }
  } catch {
    // ignore
  }

  return `${tracks.length} track(s)${timeSig}:\n${lines.join("\n")}`;
}
