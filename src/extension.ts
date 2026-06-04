import {
  initialize,
  MidiTrack,
  type ActivationContext,
  type Handle,
} from "@ableton-extensions/sdk";
import { generateMidiFromPrompt } from "./generateMidi.js";

const PROMPT_DIALOG_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      background: #1e1e1e; color: #d4d4d4;
      padding: 20px; height: 100vh;
      display: flex; flex-direction: column; gap: 12px;
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
  <label>Describe the MIDI pattern</label>
  <textarea id="prompt"
    placeholder="e.g. a funky 4-bar bassline in C minor, syncopated 16th notes"
    autofocus></textarea>
  <div class="buttons">
    <button class="cancel" onclick="cancel()">Cancel</button>
    <button class="generate" id="generateBtn" onclick="submit()">Generate</button>
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
    document.getElementById('prompt').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
    });
  </script>
</body>
</html>`;

export async function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");

  context.commands.registerCommand("generateMidi", async (...args) => {
    const handle = args[0] as Handle;
    const track = context.getObjectFromHandle(handle, MidiTrack);

    // Show the prompt input dialog
    const dialogUrl = `data:text/html,${encodeURIComponent(PROMPT_DIALOG_HTML)}`;
    let result: string;
    try {
      result = await context.ui.showModalDialog(dialogUrl, 480, 240);
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

    // Generate and insert the clip
    await context.ui.withinProgressDialog(
      "Generating MIDI...",
      { progress: 0 },
      async (update, signal) => {
        await update("Asking Claude...", 10);

        let generated;
        try {
          generated = await generateMidiFromPrompt(prompt, { songContext });
        } catch (err) {
          await update(`Error: ${String(err)}`, 0);
          await new Promise((resolve) => setTimeout(resolve, 3000));
          return;
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

        if (generated.instrument && !signal.aborted) {
          await update(`Loading ${generated.instrument.name}...`, 65);
          try {
            await newTrack.insertDevice(generated.instrument.name, 0);
          } catch {
            // Device not installed — track is left empty, user can load manually
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
  ]);
}
