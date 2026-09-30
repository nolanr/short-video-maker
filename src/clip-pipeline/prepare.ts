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
import { isUrl, type SegmentInput, type TimelineInput } from "./timeline";

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
// several tokens; drop everything inside brackets or parentheses.
function dropNonSpeech(captions: Caption[]): Caption[] {
  let depth = 0;
  return captions.filter((c) => {
    const text = c.text.trim();
    const opens = (text.match(/[([]/g) ?? []).length;
    const closes = (text.match(/[)\]]/g) ?? []).length;
    const inside = depth > 0 || opens > 0;
    depth = Math.max(0, depth + opens - closes);
    return !inside && text !== "";
  });
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
    let captions: Caption[] = [];
    if (wantCaptions) {
      const wavPath = path.join(
        deps.workDir,
        "audio",
        `${path.basename(cutPath, ".mp4")}.wav`,
      );
      await deps.ffmpeg.extractWav(cutPath, wavPath);
      captions = dropNonSpeech(await deps.whisper.CreateCaption(wavPath));
    }

    segments.push({
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
    });
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
