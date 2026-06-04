import {
  initialize,
  MidiClip,
  MidiTrack,
  type ActivationContext,
  type Handle,
} from "@ableton-extensions/sdk";
import { generateMidiFromPrompt, detectUserSpecifiedInstrument } from "./generateMidi.js";

function makeDialog(
  label: string,
  placeholder: string,
  submitLabel: string,
  opts?: { hints?: string; examples?: string[] }
): string {
  const hintsHtml = opts?.hints
    ? `<p class="hints">${opts.hints}</p>`
    : "";
  const examplesHtml = opts?.examples?.length
    ? `<div class="examples">${opts.examples.map((e) => `<button class="example" onclick="fillPrompt(this)">${e}</button>`).join("")}</div>`
    : "";
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      background: #1e1e1e; color: #d4d4d4;
      padding: 20px; height: 100vh;
      display: flex; flex-direction: column; gap: 10px;
    }
    label { font-size: 12px; font-weight: 600; color: #999; text-transform: uppercase; letter-spacing: 0.05em; }
    textarea {
      flex: 1; width: 100%; background: #2d2d2d; color: #d4d4d4;
      border: 1px solid #3e3e3e; border-radius: 4px;
      padding: 10px; font-size: 13px; line-height: 1.5; resize: none;
      outline: none;
    }
    textarea:focus { border-color: #ff7043; }
    textarea::placeholder { color: #555; }
    .hints { font-size: 11px; color: #555; }
    .examples { display: flex; flex-wrap: wrap; gap: 5px; }
    .example {
      background: #252525; border: 1px solid #383838; color: #666;
      border-radius: 3px; padding: 3px 8px; font-size: 11px;
      cursor: pointer; font-weight: 400; text-align: left; line-height: 1.4;
    }
    .example:hover { background: #2d2d2d; color: #999; border-color: #444; }
    .buttons { display: flex; gap: 8px; justify-content: flex-end; }
    button {
      padding: 7px 18px; border-radius: 4px; cursor: pointer;
      font-size: 13px; border: none; font-weight: 500;
    }
    .cancel { background: #3a3a3a; color: #aaa; }
    .cancel:hover { background: #444; }
    .generate { background: #ff7043; color: #fff; }
    .generate:hover { background: #f4511e; }
    .generate:disabled { background: #5a3530; color: #888; cursor: default; }
  </style>
</head>
<body>
  <label>${label}</label>
  <textarea id="prompt" placeholder="${placeholder}" autofocus></textarea>
  ${hintsHtml}
  ${examplesHtml}
  <div class="buttons">
    <button class="cancel" onclick="cancel()">Cancel</button>
    <button class="generate" id="generateBtn" onclick="submit()">${submitLabel}</button>
  </div>
  <script>
    function post(payload) {
      const msg = { method: 'close_and_send', params: [JSON.stringify(payload)] };
      if (window.webkit?.messageHandlers?.live) {
        window.webkit.messageHandlers.live.postMessage(msg);
      } else if (window.chrome?.webview) {
        window.chrome.webview.postMessage(msg);
      }
    }
    function submit() {
      const prompt = document.getElementById('prompt').value.trim();
      if (!prompt) return;
      document.getElementById('generateBtn').disabled = true;
      post({ prompt });
    }
    function cancel() { post({}); }
    function fillPrompt(btn) {
      document.getElementById('prompt').value = btn.textContent;
      document.getElementById('prompt').focus();
    }
    document.getElementById('prompt').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
    });
  </script>
</body>
</html>`;
}

const PROMPT_DIALOG_HTML = makeDialog(
  "Describe the MIDI pattern",
  "4-bar funk bassline in C minor, syncopated 16ths, ghost notes",
  "Generate",
  {
    hints: "Tip: be specific — <strong style='color:#777'>key · style · feel · bars · technique</strong> gives the best results",
    examples: [
      "4-bar funk bassline in C minor, syncopated 16ths, ghost notes",
      "8-bar jazz piano chords in F major, swung 8ths, medium density",
      "2-bar trap hi-hat pattern, 16th grid, varied velocity and open hats",
      "4-bar lead melody in A Dorian, pentatonic, question-answer phrasing",
      "1-bar drum loop, kick on 1 and 3, snare on 2 and 4, 8th hi-hats",
    ],
  }
);

const REFINE_DIALOG_HTML = makeDialog(
  "What would you like to change?",
  "e.g. more syncopation, add swing, brighter melody, slower feel...",
  "Refine"
);

export async function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");

  context.commands.registerCommand("generateMidi", async (...args) => {
    const handle = args[0] as Handle;
    const track = context.getObjectFromHandle(handle, MidiTrack);

    // Show the prompt input dialog
    const dialogUrl = `data:text/html,${encodeURIComponent(PROMPT_DIALOG_HTML)}`;
    let result: string;
    try {
      result = await context.ui.showModalDialog(dialogUrl, 480, 380);
    } catch {
      return; // dialog errored or was dismissed
    }

    const { prompt } = JSON.parse(result) as { prompt?: string };
    if (!prompt) return; // user cancelled

    const song = context.application.song;
    const songContext = {
      tempo: song.tempo,
      rootNote: song.rootNote,
      scaleName: song.scaleName,
    };
    const userInstrument = detectUserSpecifiedInstrument(prompt);

    // Generate and insert the clip
    await context.ui.withinProgressDialog(
      "Generating MIDI...",
      { progress: 0 },
      async (update, signal) => {
        await update("Asking Claude...", 10);

        let generated;
        try {
          generated = await generateMidiFromPrompt(prompt, {
            suggestInstrument: true,
            songContext,
          });
        } catch (err) {
          await update(`Error: ${String(err)}`, 0);
          await new Promise((resolve) => setTimeout(resolve, 3000));
          return;
        }

        if (signal.aborted) return;

        // Instrument loading: user-specified always wins; otherwise only load when track is empty.
        const hasExistingDevices = track.devices.length > 0;
        const instrumentName = userInstrument ?? generated.instrument?.name;

        if (instrumentName && (userInstrument !== undefined || !hasExistingDevices)) {
          const reason = hasExistingDevices ? "user specified" : "suggested";
          console.log(`[generateMidi] Loading ${instrumentName} (${reason})`);
          await update(`Loading ${instrumentName}...`, 70);
          try {
            await track.insertDevice(instrumentName, 0);
          } catch (err) {
            console.error(`[generateMidi] insertDevice("${instrumentName}") failed:`, err);
            await update(`⚠ Could not load ${instrumentName}`, 70);
            await new Promise((r) => setTimeout(r, 1500));
          }
        } else if (hasExistingDevices) {
          console.log(`[generateMidi] Skipping instrument — track already has ${track.devices.length} device(s); specify one in your prompt to override`);
        }

        if (signal.aborted) return;
        await update("Creating clip...", 85);

        // Place after the last arrangement clip on this track
        const clips = track.arrangementClips;
        const startTime =
          clips.length > 0 ? Math.max(...clips.map((c) => c.endTime)) : 0;

        const clip = await track.createMidiClip(startTime, generated.clipLength);
        clip.notes = generated.notes;
        clip.name = prompt.slice(0, 40);

        await update("Done!", 100);
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
    );
  });

  context.commands.registerCommand("generateMidiNewTrack", async () => {
    const dialogUrl = `data:text/html,${encodeURIComponent(PROMPT_DIALOG_HTML)}`;
    let result: string;
    try {
      result = await context.ui.showModalDialog(dialogUrl, 480, 380);
    } catch {
      return;
    }

    const { prompt } = JSON.parse(result) as { prompt?: string };
    if (!prompt) return;

    const song = context.application.song;
    const songContext = {
      tempo: song.tempo,
      rootNote: song.rootNote,
      scaleName: song.scaleName,
    };
    const userInstrument = detectUserSpecifiedInstrument(prompt);

    await context.ui.withinProgressDialog(
      "Generating MIDI...",
      { progress: 0 },
      async (update, signal) => {
        await update("Asking Claude...", 10);

        let generated;
        try {
          generated = await generateMidiFromPrompt(prompt, {
            suggestInstrument: true,
            songContext,
          });
        } catch (err) {
          await update(`Error: ${String(err)}`, 0);
          await new Promise((r) => setTimeout(r, 3000));
          return;
        }

        if (signal.aborted) return;
        await update("Creating track...", 45);

        const newTrack = await song.createMidiTrack();
        newTrack.name = prompt.slice(0, 40);

        // User-specified instrument takes priority over Claude's suggestion.
        const instrumentName = userInstrument ?? generated.instrument?.name;
        if (instrumentName && !signal.aborted) {
          const reason = userInstrument ? "user specified" : "suggested";
          console.log(`[generateMidiNewTrack] Loading ${instrumentName} (${reason})`);
          await update(`Loading ${instrumentName}...`, 65);
          try {
            await newTrack.insertDevice(instrumentName, 0);
          } catch (err) {
            console.error(`[generateMidiNewTrack] insertDevice("${instrumentName}") failed:`, err);
            await update(`⚠ Could not load ${instrumentName}`, 65);
            await new Promise((r) => setTimeout(r, 1500));
          }
        }

        if (signal.aborted) return;
        await update("Creating clip...", 85);

        const clip = await newTrack.createMidiClip(0, generated.clipLength);
        clip.notes = generated.notes;
        clip.name = prompt.slice(0, 40);

        await update("Done!", 100);
        await new Promise((r) => setTimeout(r, 600));
      }
    );
  });

  context.commands.registerCommand("refineMidi", async (...args) => {
    const handle = args[0] as Handle;
    const clip = context.getObjectFromHandle(handle, MidiClip);

    const dialogUrl = `data:text/html,${encodeURIComponent(REFINE_DIALOG_HTML)}`;
    let result: string;
    try {
      result = await context.ui.showModalDialog(dialogUrl, 480, 240);
    } catch {
      return;
    }

    const { prompt } = JSON.parse(result) as { prompt?: string };
    if (!prompt) return;

    const song = context.application.song;
    const songContext = {
      tempo: song.tempo,
      rootNote: song.rootNote,
      scaleName: song.scaleName,
    };
    const refinement = {
      notes: clip.notes,
      clipLength: clip.duration,
      originalPrompt: clip.name,
    };

    await context.ui.withinProgressDialog(
      "Refining MIDI...",
      { progress: 0 },
      async (update, signal) => {
        await update("Asking Claude...", 10);

        let generated;
        try {
          generated = await generateMidiFromPrompt(prompt, { songContext, refinement });
        } catch (err) {
          await update(`Error: ${String(err)}`, 0);
          await new Promise((r) => setTimeout(r, 3000));
          return;
        }

        if (signal.aborted) return;
        await update("Updating clip...", 85);

        clip.notes = generated.notes;

        await update("Done!", 100);
        await new Promise((r) => setTimeout(r, 600));
      }
    );
  });

  await Promise.all([
    context.ui.registerContextMenuAction(
      "MidiTrack",
      "Generate MIDI from prompt...",
      "generateMidi"
    ),
    context.ui.registerContextMenuAction(
      "Scene",
      "Generate MIDI on new track...",
      "generateMidiNewTrack"
    ),
    context.ui.registerContextMenuAction(
      "AudioTrack",
      "Generate MIDI on new track...",
      "generateMidiNewTrack"
    ),
    context.ui.registerContextMenuAction(
      "MidiClip",
      "Refine MIDI...",
      "refineMidi"
    ),
  ]);
}
