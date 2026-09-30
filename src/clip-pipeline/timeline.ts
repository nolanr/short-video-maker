import { z } from "zod";
import {
  captionStyleSchema,
  layoutSchema,
  transitionSchema,
} from "../components/clips/schema";

// The user-authored timeline: which parts of which streams to splice together,
// and what to put on top. See examples/timeline.example.json.

// "1:02:03.5", "02:03", "123.5" or 123.5 -> seconds
export const timestamp = z
  .union([z.number(), z.string()])
  .transform((value, ctx) => {
    if (typeof value === "number") return value;
    const parts = value.trim().split(":");
    if (parts.length > 3 || parts.some((p) => p === "" || isNaN(Number(p)))) {
      ctx.addIssue({ code: "custom", message: `Invalid timestamp "${value}"` });
      return z.NEVER;
    }
    return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
  });

// Effects are placed either relative to the segment start (atMs) or at a
// timestamp in the source video (at), whichever is easier to read off.
const timed = z.object({
  at: timestamp.optional(),
  atMs: z.number().min(0).optional(),
  durationMs: z.number().positive(),
});

const vfxInput = z.discriminatedUnion("type", [
  timed.extend({ type: z.literal("zoom"), scale: z.number().optional() }),
  timed.extend({ type: z.literal("shake"), intensity: z.number().optional() }),
  timed.extend({ type: z.literal("flash"), color: z.string().optional() }),
]);

const overlayPosition = z.enum(["top", "center", "bottom"]).optional();
const overlayInput = z.discriminatedUnion("type", [
  timed.extend({
    type: z.literal("text"),
    text: z.string(),
    position: overlayPosition,
    color: z.string().optional(),
    fontSize: z.number().optional(),
  }),
  timed.extend({
    type: z.literal("image"),
    // local path or URL
    src: z.string(),
    position: overlayPosition,
    widthPct: z.number().optional(),
  }),
]);

const sfxInput = z.object({
  // local path or URL
  src: z.string(),
  at: timestamp.optional(),
  atMs: z.number().min(0).optional(),
  volume: z.number().min(0).optional(),
});

export const segmentInput = z.object({
  source: z.string().describe("Key into `sources`"),
  start: timestamp,
  end: timestamp,
  layout: layoutSchema.optional(),
  transitionIn: transitionSchema.optional(),
  captions: z.boolean().optional(),
  volume: z.number().min(0).optional(),
  vfx: z.array(vfxInput).default([]),
  overlays: z.array(overlayInput).default([]),
  sfx: z.array(sfxInput).default([]),
});
export type SegmentInput = z.infer<typeof segmentInput>;

export const timelineInput = z.object({
  // id -> Twitch/Kick/YouTube URL (anything yt-dlp supports) or local file path
  sources: z.record(z.string(), z.string()),
  defaults: z
    .object({
      layout: layoutSchema.default({ type: "blur" }),
      transitionIn: transitionSchema.optional(),
      captions: z.boolean().default(true),
      volume: z.number().min(0).default(1),
    })
    .default({}),
  segments: z.array(segmentInput).min(1),
  captionStyle: captionStyleSchema.default({}),
  music: z
    .object({
      src: z.string(),
      volume: z.number().min(0).optional(),
      duckedVolume: z.number().min(0).optional(),
    })
    .optional(),
  output: z
    .object({
      fps: z.number().default(30),
      width: z.number().default(1080),
      height: z.number().default(1920),
    })
    .default({}),
});
export type TimelineInput = z.infer<typeof timelineInput>;

export const isUrl = (s: string) => /^https?:\/\//i.test(s);
