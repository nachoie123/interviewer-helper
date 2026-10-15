# Interviewer Helper

A small panel for macOS that listens to your call or interview and writes an answer you can say out loud, about a second after the question ends.

- Hears the other person through your mic and shows their words live (on-device).
- Detects questions and answers them in English or Spanish, first line ready to read aloud.
- Uses your own profile (CV or a few lines about you) for "tell me about yourself" questions. Without one, personal answers get `[your example]` placeholders instead of invented facts.
- ⌘⇧S reads a question on your screen (needs Screen Recording permission).

**Download:** [Interviewer-Helper-1.0.0.pkg](https://github.com/nachoie123/interviewer-helper/releases/latest) for Apple Silicon Macs. Signed and notarized. Free.

## What you need

A free Groq API key from [console.groq.com/keys](https://console.groq.com/keys). The app asks for it on first launch. Transcription and answers run on Groq's free tier (about 1,000 answers a day).

Your key and profile stay on your Mac, in `~/Library/Application Support/Interviewer Helper/` (`.env` and `profile.md`). Change them any time from the ··· menu. A sample profile is in [`examples/sample-profile.md`](examples/sample-profile.md).

## Shortcuts

| Keys | Action |
| --- | --- |
| ⌥R | Pause / resume listening |
| ⌘⇧S | Screenshot and answer |
| ⌘⇧V | Show / hide |
| ⌘⇧C | Transcript |
| ⌥A | Clickable / click-through |

## Build from source

```bash
npm install
native/live-stt/build.sh
npm start
```

`npm run build:mac` builds the app; signing uses the identity in `package.json`.

## Credits

Based on [OpenCluely](https://github.com/TechyCSR/OpenCluely) by TechyCSR, Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

Made by [Ignacio San Benito](https://nachosanbenito.com) · IE University.
