import fs from "node:fs/promises";
import path from "node:path";
import {
  initialize,
  MidiClip,
  MidiTrack,
  type ActivationContext,
  type Handle,
} from "@ableton-extensions/sdk";
import {
  generateMidiFromPrompt,
  detectUserSpecifiedInstrument,
  type SongContext,
} from "./generateMidi.js";
import { buildSessionContext } from "./sessionContext.js";
import { snapToScale } from "./snapToScale.js";

// ---------------------------------------------------------------------------
// Co-pilot state (persisted to storageDirectory)
// ---------------------------------------------------------------------------

interface ChatEntry {
  userMessage: string;
  generatedSummary: string;
  timestamp: number;
}

interface CopilotState {
  history: ChatEntry[];
  snapToScale: boolean;
}

async function loadCopilotState(storageDir: string | undefined): Promise<CopilotState> {
  if (!storageDir) return { history: [], snapToScale: false };
  try {
    const raw = await fs.readFile(path.join(storageDir, "copilot-history.json"), "utf-8");
    return JSON.parse(raw) as CopilotState;
  } catch {
    return { history: [], snapToScale: false };
  }
}

async function saveCopilotState(storageDir: string | undefined, state: CopilotState): Promise<void> {
  if (!storageDir) return;
  try {
    await fs.writeFile(
      path.join(storageDir, "copilot-history.json"),
      JSON.stringify(state, null, 2),
      "utf-8"
    );
  } catch (err) {
    console.error("[copilot] Failed to save state:", err);
  }
}

// ---------------------------------------------------------------------------
// Dialog HTML builders
// ---------------------------------------------------------------------------

function buildChatDialog(
  history: ChatEntry[],
  snapChecked: boolean,
  contextLabel: string
): string {
  const historyJson = JSON.stringify(history).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  const checked = snapChecked ? "checked" : "";
  const escaped = contextLabel.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      background: #1e1e1e; color: #d4d4d4;
      display: flex; flex-direction: column; height: 100vh; overflow: hidden;
    }
    .header {
      padding: 12px 16px 8px; border-bottom: 1px solid #2a2a2a; flex-shrink: 0;
    }
    .header h1 { font-size: 10px; font-weight: 700; color: #ff7043; text-transform: uppercase; letter-spacing: 0.1em; }
    .ctx { font-size: 11px; color: #555; margin-top: 3px; }
    .history {
      flex: 1; overflow-y: auto; padding: 12px 14px;
      display: flex; flex-direction: column; gap: 6px; min-height: 0;
    }
    .empty-hint { color: #333; font-size: 12px; font-style: italic; margin: auto; text-align: center; }
    .msg { max-width: 84%; padding: 6px 10px; border-radius: 6px; font-size: 12px; line-height: 1.45; word-break: break-word; }
    .msg.user { background: #3a2820; color: #d4a090; align-self: flex-end; border-bottom-right-radius: 2px; }
    .msg.assistant { background: #252525; color: #888; align-self: flex-start; border-bottom-left-radius: 2px; }
    .footer { padding: 10px 14px 12px; border-top: 1px solid #2a2a2a; flex-shrink: 0; display: flex; flex-direction: column; gap: 8px; }
    textarea {
      width: 100%; background: #2d2d2d; color: #d4d4d4;
      border: 1px solid #3e3e3e; border-radius: 4px;
      padding: 8px 10px; font-size: 13px; line-height: 1.5; resize: none; height: 68px;
      outline: none; font-family: inherit;
    }
    textarea:focus { border-color: #ff7043; }
    textarea::placeholder { color: #3e3e3e; }
    .footer-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .snap { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #555; cursor: pointer; user-select: none; }
    .snap input { accent-color: #ff7043; cursor: pointer; }
    .snap:hover { color: #777; }
    .btns { display: flex; gap: 8px; }
    button { padding: 6px 16px; border-radius: 4px; cursor: pointer; font-size: 12px; border: none; font-weight: 500; }
    .cancel { background: #333; color: #777; }
    .cancel:hover { background: #3a3a3a; }
    .send { background: #ff7043; color: #fff; }
    .send:hover { background: #f4511e; }
    .send:disabled { background: #5a3530; color: #666; cursor: default; }
  </style>
</head>
<body>
  <div class="header">
    <h1>AI Co-pilot</h1>
    <div class="ctx">${escaped}</div>
  </div>
  <div class="history" id="hist"></div>
  <div class="footer">
    <textarea id="prompt" placeholder="Describe what to generate or how to refine..." autofocus></textarea>
    <div class="footer-row">
      <label class="snap">
        <input type="checkbox" id="snapCheck" ${checked}>
        Snap to scale
      </label>
      <div class="btns">
        <button class="cancel" onclick="cancel()">Close</button>
        <button class="send" id="sendBtn" onclick="submit()">Generate</button>
      </div>
    </div>
  </div>
  <script>
    const hist = ${historyJson};
    const el = document.getElementById('hist');
    if (hist.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'empty-hint';
      hint.textContent = 'Type a prompt to get started...';
      el.appendChild(hint);
    } else {
      hist.forEach(e => {
        const u = document.createElement('div'); u.className = 'msg user'; u.textContent = e.userMessage; el.appendChild(u);
        const a = document.createElement('div'); a.className = 'msg assistant'; a.textContent = e.generatedSummary; el.appendChild(a);
      });
      el.scrollTop = el.scrollHeight;
    }
    function post(p) {
      const m = { method: 'close_and_send', params: [JSON.stringify(p)] };
      if (window.webkit?.messageHandlers?.live) window.webkit.messageHandlers.live.postMessage(m);
      else if (window.chrome?.webview) window.chrome.webview.postMessage(m);
    }
    function submit() {
      const v = document.getElementById('prompt').value.trim();
      if (!v) return;
      document.getElementById('sendBtn').disabled = true;
      post({ prompt: v, snapToScale: document.getElementById('snapCheck').checked });
    }
    function cancel() { post({}); }
    document.getElementById('prompt').addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
    });
  </script>
</body>
</html>`;
}

// Legacy one-shot prompt dialog (kept for generateMidi / generateMidiNewTrack commands)
function makeDialog(
  label: string,
  placeholder: string,
  submitLabel: string,
  opts?: { hints?: string; examples?: string[] }
): string {
  const hintsHtml = opts?.hints ? `<p class="hints">${opts.hints}</p>` : "";
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSongContext(song: ReturnType<typeof initialize>["application"]["song"]): SongContext {
  let timeSignature: SongContext["timeSignature"];
  try {
    const s = song.scenes[0];
    if (s) timeSignature = { numerator: s.signatureNumerator, denominator: s.signatureDenominator };
  } catch { /* no scenes */ }

  let scaleIntervals: number[] | undefined;
  try { scaleIntervals = song.scaleIntervals; } catch { /* unavailable */ }

  return {
    tempo: song.tempo,
    rootNote: song.rootNote,
    scaleName: song.scaleName,
    scaleIntervals,
    timeSignature,
  };
}

// ---------------------------------------------------------------------------
// activate
// ---------------------------------------------------------------------------

export async function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");
  const storageDir = context.environment.storageDirectory;

  // -------------------------------------------------------------------------
  // openChat — persistent co-pilot loop (primary entry point)
  // -------------------------------------------------------------------------
  context.commands.registerCommand("openChat", async (...args) => {
    const handle = args[0] as Handle;
    const song = context.application.song;

    // Resolve handle type — try clip, then track, then fall back to new-track (Scene/AudioTrack)
    const resolveMode = () => {
      try { return { kind: "clip" as const, clip: context.getObjectFromHandle(handle, MidiClip) }; } catch {}
      try { return { kind: "track" as const, track: context.getObjectFromHandle(handle, MidiTrack) }; } catch {}
      return { kind: "new-track" as const };
    };
    const mode = resolveMode();

    const contextLabel =
      mode.kind === "clip"
        ? `Refining: ${mode.clip.name || "untitled clip"}`
        : mode.kind === "track"
        ? `Track: ${mode.track.name}`
        : "Creating new MIDI track";

    while (true) {
      const state = await loadCopilotState(storageDir);
      const dialogHtml = buildChatDialog(state.history.slice(-6), state.snapToScale, contextLabel);
      const dialogUrl = `data:text/html,${encodeURIComponent(dialogHtml)}`;

      let result: string;
      try {
        result = await context.ui.showModalDialog(dialogUrl, 500, 620);
      } catch {
        break;
      }

      const { prompt, snapToScale: snapEnabled } = JSON.parse(result) as {
        prompt?: string;
        snapToScale?: boolean;
      };
      if (!prompt) break;

      const songCtx = getSongContext(song);
      const sessionCtx = buildSessionContext(song) || undefined;
      const userInstrument = mode.kind !== "clip" ? detectUserSpecifiedInstrument(prompt) : undefined;

      let generatedSummary = "";

      await context.ui.withinProgressDialog(
        mode.kind === "clip" ? "Refining MIDI..." : "Generating MIDI...",
        { progress: 0 },
        async (update, signal) => {
          await update("Asking Claude...", 10);

          const refinement =
            mode.kind === "clip"
              ? {
                  notes: mode.clip.notes,
                  clipLength: mode.clip.duration,
                  originalPrompt: mode.clip.name,
                }
              : undefined;

          let generated;
          try {
            generated = await generateMidiFromPrompt(prompt, {
              suggestInstrument: mode.kind !== "clip",
              songContext: songCtx,
              sessionContext: sessionCtx,
              refinement,
            });
          } catch (err) {
            await update(`Error: ${String(err)}`, 0);
            await new Promise((r) => setTimeout(r, 3000));
            return;
          }

          if (signal.aborted) return;

          // Apply scale snapping when opted in and scale mode is active
          let notes = generated.notes;
          const intervals = songCtx.scaleIntervals;
          if (snapEnabled && song.scaleMode && intervals && intervals.length > 0) {
            const snapped = snapToScale(notes, intervals, songCtx.rootNote);
            const adjusted = snapped.filter((n, i) => n.pitch !== notes[i]?.pitch).length;
            if (adjusted > 0) console.log(`[snapToScale] adjusted ${adjusted} of ${notes.length} notes`);
            notes = snapped;
          }

          if (mode.kind === "clip") {
            await update("Updating clip...", 85);
            mode.clip.notes = notes;
            generatedSummary = `Refined "${mode.clip.name || "clip"}" (${notes.length} notes)`;
          } else {
            const track = mode.kind === "track"
              ? mode.track
              : await song.createMidiTrack().then((t) => { t.name = prompt.slice(0, 40); return t; });

            const hasExistingDevices = track.devices.length > 0;
            const instrumentName = userInstrument ?? generated.instrument?.name;

            if (instrumentName && (userInstrument !== undefined || !hasExistingDevices)) {
              const reason = userInstrument ? "user specified" : "suggested";
              console.log(`[openChat] Loading ${instrumentName} (${reason})`);
              await update(`Loading ${instrumentName}...`, 65);
              try {
                await track.insertDevice(instrumentName, 0);
              } catch (err) {
                console.error(`[openChat] insertDevice("${instrumentName}") failed:`, err);
                await update(`⚠ Could not load ${instrumentName}`, 65);
                await new Promise((r) => setTimeout(r, 1500));
              }
            } else if (hasExistingDevices) {
              console.log(`[openChat] Skipping instrument — track already has ${track.devices.length} device(s)`);
            }

            await update("Creating clip...", 85);
            const clips = track.arrangementClips;
            const startTime = clips.length > 0 ? Math.max(...clips.map((c: { endTime: number }) => c.endTime)) : 0;
            const clip = await track.createMidiClip(startTime, generated.clipLength);
            clip.notes = notes;
            clip.name = prompt.slice(0, 40);

            generatedSummary = `Generated "${clip.name}" (${notes.length} notes${instrumentName ? `, ${instrumentName}` : ""})`;
          }

          await update("Done!", 100);
          await new Promise((r) => setTimeout(r, 500));
        }
      );

      if (generatedSummary) {
        const newState: CopilotState = {
          history: [
            ...state.history,
            { userMessage: prompt, generatedSummary, timestamp: Date.now() },
          ],
          snapToScale: snapEnabled ?? false,
        };
        await saveCopilotState(storageDir, newState);
      }
    }
  });

  // -------------------------------------------------------------------------
  // Legacy commands (no context menu entries — kept for backward compat)
  // -------------------------------------------------------------------------

  context.commands.registerCommand("generateMidi", async (...args) => {
    const handle = args[0] as Handle;
    const track = context.getObjectFromHandle(handle, MidiTrack);

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
    const songCtx = getSongContext(song);
    const sessionCtx = buildSessionContext(song) || undefined;
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
            songContext: songCtx,
            sessionContext: sessionCtx,
          });
        } catch (err) {
          await update(`Error: ${String(err)}`, 0);
          await new Promise((resolve) => setTimeout(resolve, 3000));
          return;
        }

        if (signal.aborted) return;

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

        const clips = track.arrangementClips;
        const startTime = clips.length > 0 ? Math.max(...clips.map((c) => c.endTime)) : 0;
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
    const songCtx = getSongContext(song);
    const sessionCtx = buildSessionContext(song) || undefined;
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
            songContext: songCtx,
            sessionContext: sessionCtx,
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
    const songCtx = getSongContext(song);
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
          generated = await generateMidiFromPrompt(prompt, { songContext: songCtx, refinement });
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

  // -------------------------------------------------------------------------
  // Context menu — single "AI Co-pilot..." entry per scope
  // -------------------------------------------------------------------------
  await Promise.all([
    context.ui.registerContextMenuAction("MidiTrack", "AI Co-pilot...", "openChat"),
    context.ui.registerContextMenuAction("MidiClip", "AI Co-pilot...", "openChat"),
    context.ui.registerContextMenuAction("Scene", "AI Co-pilot...", "openChat"),
    context.ui.registerContextMenuAction("AudioTrack", "AI Co-pilot...", "openChat"),
  ]);
}
