// When true, the app runs entirely in the browser with no backend:
//   - speech-to-text uses the browser's built-in Web Speech API
//   - sessions / transcripts / notes are stored in localStorage
//   - the clinical note is produced by a local heuristic (no LLM)
// This is what gets deployed to GitHub Pages so the flow can be tried out
// on a single device. The full experience (two-device real-time sync, the
// real Nemotron ASR model, and Claude-generated notes) needs the FastAPI
// backend and is enabled by leaving VITE_DEMO_MODE unset.
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true'
