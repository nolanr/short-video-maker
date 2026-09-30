# Clip pipeline (Twitch / Kick → TikTok)

Splices sections of stream VODs/clips into a 9:16 short with word-highlighted
captions, transitions, VFX, overlays, SFX and ducked background music.

```
timeline.json ──► yt-dlp (section or full download, cached)
              ──► ffmpeg cut + normalize (1920x1080, constant fps)
              ──► whisper.cpp word timestamps per segment
              ──► props.json ──► Remotion `ClipVideo` composition ──► out.mp4
```

## Run

```bash
pnpm install
pip install "yt-dlp[default,curl-cffi]"   # curl-cffi is needed for Kick
pnpm clip examples/timeline.example.json -o out.mp4
```

Options: `--work <dir>` (cache dir, default `./clip-work/<name>`),
`--prepare-only` (download/cut/transcribe and write `props.json`, no render).

Environment:

| Var                   | Purpose                                                                        |
| --------------------- | ------------------------------------------------------------------------------ |
| `WHISPER_MODEL`       | e.g. `base.en` (fast), `medium.en` (default), `large-v3-turbo` for non-English |
| `NETWORK_FFMPEG_PATH` | ffmpeg used by yt-dlp for section downloads (default: `ffmpeg` on PATH)        |
| `FFMPEG_PATH`         | ffmpeg used for local cutting (default: bundled `ffmpeg-static`)               |
| `YTDLP_PATH`          | yt-dlp binary (default: `yt-dlp` on PATH)                                      |
| `CONCURRENCY`         | Remotion render concurrency                                                    |

**Install a system ffmpeg** (`apt install ffmpeg`) if you cut from long VODs.
The npm-bundled static ffmpeg builds segfault on hostname lookups on many
distros, so without a system ffmpeg yt-dlp can't fetch just a section and the
pipeline falls back to downloading the whole source once.

## Timeline format

See [`examples/timeline.example.json`](examples/timeline.example.json).

- `sources`: id → URL (anything yt-dlp supports) or local path (relative to the timeline file).
- `segments[]`: `source`, `start`, `end` as `"H:MM:SS.s"`, `"MM:SS"` or seconds in the source.
  - `layout`: `fill` (crop to cover), `blur` (fitted over a blurred copy), or
    `stack` (facecam `cam` crop on top, `game` crop below, `camHeight` fraction).
    Crops are `{x, y, w, h}` fractions (0–1) of the source frame.
  - `transitionIn`: `fade` | `slide` | `wipe` | `flip`, `durationMs`, `direction`.
    Transitions overlap the neighbouring segments.
  - `captions`: `false` to skip transcription for this segment.
  - `vfx[]`: `zoom` (`scale`), `shake` (`intensity` px), `flash` (`color`).
  - `overlays[]`: `text` (`text`, `color`, `fontSize`) or `image` (`src`, `widthPct`), with `position`.
  - `sfx[]`: `src`, `volume`.
  - Effects, overlays and SFX are timed with `atMs` (from segment start) or
    `at` (a timestamp in the source video), plus `durationMs`.
- `defaults`: `layout`, `transitionIn`, `captions`, `volume` applied to every segment.
- `captionStyle`: `position`, `highlightColor`, `fontSize`, `uppercase`, `maxCharsPerLine`.
- `music`: `src`, `volume`, `duckedVolume` (used while someone is talking).

## Code

- `src/clip-pipeline/` – CLI, timeline schema, yt-dlp wrapper, prepare step.
- `src/components/clips/` – the Remotion composition (layouts, captions, effects).
- Reuses `Whisper`, `FFMpeg` and `Remotion` from `src/short-creator/libraries/`.
