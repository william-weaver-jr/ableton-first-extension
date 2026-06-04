# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm start          # type-check + dev build + run in Live's Extension Host
npm run build:dev  # type-check + dev bundle (sourcemaps, unminified)
npm run build      # type-check + production bundle (minified, no sourcemaps)
npm run package    # production build + create .ablx archive for distribution
npm test           # run unit tests with Vitest
npm run test:watch # Vitest in watch mode
```

Type-check alone: `npx tsc --noEmit`.

## Architecture

This is an Ableton Live extension. The Extension Host is a Node.js runtime embedded in Live that loads `dist/extension.js` (a CJS bundle) and calls the exported `activate()` function at startup.

### Entry contract

`src/extension.ts` must export an `activate(activation: ActivationContext)` function. Everything initialises inside it — commands and context menu actions registered here persist for the session.

### SDK

The SDK (`@ableton-extensions/sdk`) is vendored at `vendor/ableton-extensions-sdk-1.0.0-beta.0.tgz` — **do not install it from npm**. The SDK wraps Live's internal Extension Host modules behind typed classes. All mutations (creating tracks, clips, setting notes, device parameters) are async and return Promises. The raw low-level host API is `@internal` and should never be called directly.

Key SDK types used in this project:
- `initialize(activation, "1.0.0")` → `ExtensionContext` — the root of everything
- `context.application.song` → `Song` — tracks, scenes, tempo, scale
- `context.commands` — register/execute named commands (string IDs)
- `context.ui` — `showModalDialog`, `withinProgressDialog`, `registerContextMenuAction`
- `context.resources` — `renderPreFxAudio`, `importIntoProject`
- `context.environment` — `storageDirectory`, `tempDirectory`, `language`
- `context.withinTransaction(fn)` — groups multiple mutations into one undo step (callback must be synchronous, but can return `Promise.all(...)`)

### Build

`build.ts` runs esbuild, bundling `src/extension.ts` into `dist/extension.js` as CJS (required by the Extension Host). Source files use ESM (`"type": "module"` in `package.json`) — esbuild handles the conversion. The `manifest.json` entry field (`dist/extension.js`) is what the Extension Host loads.

### Extension structure

| File | Role |
|---|---|
| `src/extension.ts` | `activate()` — registers commands and context menu actions |
| `src/generateMidi.ts` | Claude API call; returns `GeneratedMidi` (notes + clipLength + optional instrument) |

### Context menu commands

| Scope | Label | Command ID | Behaviour |
|---|---|---|---|
| `MidiTrack` | "Generate MIDI from prompt..." | `generateMidi` | Generates a clip on the right-clicked track |
| `Scene` / `AudioTrack` | "Generate MIDI on new track..." | `generateMidiNewTrack` | Creates a new MIDI track, loads a suggested instrument, drops the clip |

### Instrument loading

Both commands ask Claude to suggest a built-in Live instrument and call `track.insertDevice(name, 0)`. Failures are caught and logged — the track is left without the device rather than erroring. Valid instrument names: `Operator, Wavetable, Analog, Electric, Simpler, Impulse, Drift, Meld, Tension, Collision`.

`generateMidi` (existing track): loads the suggested instrument only when the track has no existing devices. If the user names an instrument in their prompt (e.g. "use Operator"), it is loaded regardless of existing devices. Console logs record every instrument decision.

`generateMidiNewTrack` (new track): always loads an instrument. User-specified instrument takes priority over Claude's suggestion.

### Dialog pattern

Modal dialogs are passed as `data:text/html,...` URLs. The HTML must close itself by posting `{ method: "close_and_send", params: [resultString] }` to the host's message handler — `window.webkit.messageHandlers.live` on macOS or `window.chrome.webview` on Windows. `ui.showModalDialog()` resolves with that string.

### Environment / config

`.env` is gitignored and machine-local. It holds two values:
- `EXTENSION_HOST_PATH` — path to Live's `ExtensionHostNodeModule.node`, used by the CLI
- `ANTHROPIC_API_KEY` — read at runtime via `process.env.ANTHROPIC_API_KEY`
