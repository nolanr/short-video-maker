import crypto from "crypto";
import fs from "fs-extra";
import path from "path";
import type { z } from "zod";

import {
  clipVideoSchema,
  type ClipVideoProps,
} from "../components/clips/schema";
import type { FFMpeg } from "../short-creator/libraries/FFmpeg";
import type { Whisper } from "../short-creator/libraries/Whisper";
import { logger } from "../logger";
import type { Downloader } from "./Downloader";
import {
  isUrl,
  resolvePauseTrim,
  type PauseTrim,
  type SegmentInput,
  type TimelineInput,
} from "./timeline";

type Deps = {
  ffmpeg: FFMpeg;
  whisper: Whisper;
  downloader: Downloader;
  // directory served over http during the render
  workDir: string;
  // resolves a file inside workDir to the URL Remotion should load it from
  urlFor: (fileInWorkDir: string) => string;
  // local paths in the timeline are relative to this directory
  baseDir: string;
};

const hash = (...parts: unknown[]) =>
  crypto
    .createHash("sha1")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 12);

// Local asset -> copied into workDir and served; URLs pass through untouched.
function resolveAsset(src: string, deps: Deps): string {
  if (isUrl(src)) return src;
  const abs = path.resolve(deps.baseDir, src);
  if (!fs.existsSync(abs)) throw new Error(`Asset not found: ${abs}`);
  const name = `${hash(abs)}-${path.basename(abs)}`;
  const dest = path.join(deps.workDir, "assets", name);
  fs.copySync(abs, dest);
  return deps.urlFor(dest);
}

type Caption = { text: string; startMs: number; endMs: number };

// Whisper tags non-speech as "(dramatic music)" / "[BLANK_AUDIO]", split over
// several tokens; drop everything inside brackets or parentheses. It also marks
// speaker turns with ">>" or a leading "-", which aren't words either.
function dropNonSpeech(captions: Caption[]): Caption[] {
  let depth = 0;
  return captions
    .filter((c) => {
      const text = c.text.trim();
      const opens = (text.match(/[([]/g) ?? []).length;
      const closes = (text.match(/[)\]]/g) ?? []).length;
      const inside = depth > 0 || opens > 0;
      depth = Math.max(0, depth + opens - closes);
      return !inside;
    })
    .map((c) => ({ ...c, text: c.text.replace(/>>|^\s*-+(?=\s|$)/g, "") }))
    .filter((c) => c.text.trim() !== "");
}

function toSegmentMs(
  item: { at?: number; atMs?: number },
  segment: SegmentInput,
): number {
  if (item.atMs !== undefined) return item.atMs;
  if (item.at !== undefined)
    return Math.max(0, (item.at - segment.start) * 1000);
  return 0;
}

type PreparedSegment = z.input<typeof clipVideoSchema>["segments"][number];
type Range = [number, number];

// [startMs, endMs] parts of a segment to keep: everything except silences of
// at least minGapMs between words, less padMs on each side. The segment's own
// start and end stay as authored. A pause that overlaps an effect, overlay or
// sound is kept, so nothing on screen gets cut short.
export function keepRanges(
  words: Caption[],
  durationMs: number,
  protectedRanges: Range[],
  { minGapMs, padMs }: PauseTrim,
): Range[] {
  const keep: Range[] = [];
  let start = 0;
  for (let i = 1; i < words.length; i++) {
    if (words[i].startMs - words[i - 1].endMs < minGapMs) continue;
    const gapStart = words[i - 1].endMs + padMs;
    const gapEnd = words[i].startMs - padMs;
    if (protectedRanges.some(([a, b]) => a < gapEnd && b > gapStart)) continue;
    keep.push([start, gapStart]);
    start = gapEnd;
  }
  keep.push([start, durationMs]);
  return keep;
}

// Hard-cuts a prepared segment into its kept ranges. Pieces after the first
// get no transition, and captions and timed items move to the piece they
// fall in.
async function splitAtPauses(
  segment: PreparedSegment,
  cutPath: string,
  words: Caption[],
  trim: PauseTrim,
  fps: number,
  deps: Deps,
): Promise<PreparedSegment[]> {
  const { vfx = [], overlays = [], sfx = [] } = segment;
  const SFX_MS = 1000;
  const ranges = keepRanges(
    words,
    segment.durationMs,
    [
      ...[...vfx, ...overlays].map(
        (x): Range => [x.atMs, x.atMs + x.durationMs],
      ),
      ...sfx.map((x): Range => [x.atMs, x.atMs + SFX_MS]),
    ],
    trim,
  );
  if (ranges.length === 1) return [segment];

  const pieces: PreparedSegment[] = [];
  for (const [k, [a, b]] of ranges.entries()) {
    const piecePath = cutPath.replace(/\.mp4$/, `-${a}-${b}.mp4`);
    if (!fs.existsSync(piecePath)) {
      await deps.ffmpeg.cutSegment(cutPath, a / 1000, b / 1000, piecePath, fps);
    }
    const inside = (ms: number) =>
      ms >= a && (ms < b || (k === ranges.length - 1 && ms <= b));
    const rebase = <T extends { atMs: number }>(items: T[]) =>
      items
        .filter((x) => inside(x.atMs))
        .map((x) => ({ ...x, atMs: x.atMs - a }));
    pieces.push({
      ...segment,
      videoUrl: deps.urlFor(piecePath),
      durationMs: b - a,
      transitionIn: k === 0 ? segment.transitionIn : undefined,
      captions: segment.captions
        .filter((c) => inside(c.startMs))
        .map((c) => ({
          ...c,
          startMs: c.startMs - a,
          endMs: Math.min(c.endMs, b) - a,
        })),
      vfx: rebase(vfx),
      overlays: rebase(overlays),
      sfx: rebase(sfx),
    });
  }
  return pieces;
}

async function cutSource(
  sourceRef: string,
  segment: SegmentInput,
  fps: number,
  deps: Deps,
): Promise<string> {
  const key = hash(sourceRef, segment.start, segment.end, fps);
  const cutPath = path.join(deps.workDir, "segments", `${key}.mp4`);
  if (fs.existsSync(cutPath)) return cutPath;

  const duration = segment.end - segment.start;
  if (isUrl(sourceRef) && deps.downloader.canDownloadSections) {
    const rawPath = path.join(deps.workDir, "downloads", `${key}.mp4`);
    await deps.downloader.downloadSection(
      sourceRef,
      segment.start,
      segment.end,
      rawPath,
    );
    // downloaded section already starts at segment.start; this just normalizes
    await deps.ffmpeg.cutSegment(rawPath, 0, duration, cutPath, fps);
  } else if (isUrl(sourceRef)) {
    // one full download per source, shared by all its segments
    const rawPath = path.join(
      deps.workDir,
      "downloads",
      `${hash(sourceRef)}.mp4`,
    );
    await deps.downloader.downloadFull(sourceRef, rawPath);
    await deps.ffmpeg.cutSegment(
      rawPath,
      segment.start,
      segment.end,
      cutPath,
      fps,
    );
  } else {
    const abs = path.resolve(deps.baseDir, sourceRef);
    await deps.ffmpeg.cutSegment(abs, segment.start, segment.end, cutPath, fps);
  }
  return cutPath;
}

export async function prepareTimeline(
  timeline: TimelineInput,
  deps: Deps,
): Promise<ClipVideoProps> {
  const { fps } = timeline.output;
  ["segments", "downloads", "assets", "audio"].forEach((d) =>
    fs.ensureDirSync(path.join(deps.workDir, d)),
  );

  const segments: z.input<typeof clipVideoSchema>["segments"] = [];
  for (const [i, segment] of timeline.segments.entries()) {
    const sourceRef = timeline.sources[segment.source];
    if (!sourceRef) {
      throw new Error(`Segment ${i}: unknown source "${segment.source}"`);
    }
    if (segment.end <= segment.start) {
      throw new Error(`Segment ${i}: end must be after start`);
    }
    logger.info(
      {
        segment: i,
        source: segment.source,
        start: segment.start,
        end: segment.end,
      },
      "Preparing segment",
    );

    const cutPath = await cutSource(sourceRef, segment, fps, deps);

    const wantCaptions = segment.captions ?? timeline.defaults.captions;
    const trim = resolvePauseTrim(
      segment.trimPauses ?? timeline.defaults.trimPauses,
    );
    // pause trimming needs word timings even when captions are off
    let words: Caption[] = [];
    if (wantCaptions || trim) {
      const wavPath = path.join(
        deps.workDir,
        "audio",
        `${path.basename(cutPath, ".mp4")}.wav`,
      );
      await deps.ffmpeg.extractWav(cutPath, wavPath);
      words = dropNonSpeech(await deps.whisper.CreateCaption(wavPath));
    }
    const captions = wantCaptions ? words : [];

    const prepared: PreparedSegment = {
      videoUrl: deps.urlFor(cutPath),
      durationMs: (segment.end - segment.start) * 1000,
      volume: segment.volume ?? timeline.defaults.volume,
      layout: segment.layout ?? timeline.defaults.layout,
      transitionIn:
        i === 0
          ? undefined
          : (segment.transitionIn ?? timeline.defaults.transitionIn),
      captions,
      vfx: segment.vfx.map(({ at, atMs, ...fx }) => ({
        ...fx,
        atMs: toSegmentMs({ at, atMs }, segment),
      })),
      overlays: segment.overlays.map(({ at, atMs, ...overlay }) => ({
        ...overlay,
        atMs: toSegmentMs({ at, atMs }, segment),
        ...(overlay.type === "image"
          ? { src: resolveAsset(overlay.src, deps) }
          : {}),
      })),
      sfx: segment.sfx.map(({ at, atMs, ...sfx }) => ({
        ...sfx,
        src: resolveAsset(sfx.src, deps),
        atMs: toSegmentMs({ at, atMs }, segment),
      })),
    };
    if (!trim) {
      segments.push(prepared);
      continue;
    }
    const pieces = await splitAtPauses(
      prepared,
      cutPath,
      words,
      trim,
      fps,
      deps,
    );
    const keptMs = pieces.reduce((sum, p) => sum + p.durationMs, 0);
    logger.info(
      {
        segment: i,
        pieces: pieces.length,
        cutMs: Math.round(prepared.durationMs - keptMs),
      },
      "Trimmed pauses",
    );
    segments.push(...pieces);
  }

  const props = clipVideoSchema.parse({
    ...timeline.output,
    segments,
    captionStyle: timeline.captionStyle,
    music: timeline.music
      ? {
          url: resolveAsset(timeline.music.src, deps),
          volume: timeline.music.volume,
          duckedVolume: timeline.music.duckedVolume,
        }
      : undefined,
  });

  // a transition overlaps both neighbours, so it must be shorter than each
  props.segments.forEach((s, i) => {
    if (!s.transitionIn) return;
    const prev = props.segments[i - 1];
    if (s.transitionIn.durationMs >= Math.min(s.durationMs, prev.durationMs)) {
      throw new Error(
        `Segment ${i}: transition (${s.transitionIn.durationMs}ms) must be shorter than both adjacent segments`,
      );
    }
  });

  return props;
}
