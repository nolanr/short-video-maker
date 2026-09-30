import { z } from "zod";
import type { Caption } from "../../types/shorts";

// Render-time props for the ClipVideo composition. Everything here is
// already resolved by the prepare step: media are http URLs, times are
// segment-relative milliseconds, sources are normalized to SOURCE_WIDTH x SOURCE_HEIGHT.

export const SOURCE_WIDTH = 1920;
export const SOURCE_HEIGHT = 1080;

// crop rect as fractions (0-1) of the source frame
export const cropRect = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().gt(0).max(1),
  h: z.number().gt(0).max(1),
});
export type CropRect = z.infer<typeof cropRect>;

export const layoutSchema = z.discriminatedUnion("type", [
  // crop (default: whole frame) scaled to cover the 9:16 frame
  z.object({ type: z.literal("fill"), crop: cropRect.optional() }),
  // full source fitted to width, blurred copy behind it
  z.object({ type: z.literal("blur"), crop: cropRect.optional() }),
  // facecam on top, gameplay below
  z.object({
    type: z.literal("stack"),
    cam: cropRect,
    game: cropRect,
    camHeight: z.number().gt(0).lt(1).default(0.35),
  }),
]);
export type Layout = z.infer<typeof layoutSchema>;

export const transitionSchema = z.object({
  type: z.enum(["fade", "slide", "wipe", "flip"]),
  durationMs: z.number().positive().default(300),
  direction: z
    .enum(["from-left", "from-right", "from-top", "from-bottom"])
    .default("from-right"),
});
export type Transition = z.infer<typeof transitionSchema>;

const timed = {
  atMs: z.number().min(0),
  durationMs: z.number().positive(),
};

export const vfxSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("zoom"),
    ...timed,
    scale: z.number().default(1.25),
  }),
  z.object({
    type: z.literal("shake"),
    ...timed,
    intensity: z.number().default(20),
  }),
  z.object({
    type: z.literal("flash"),
    ...timed,
    color: z.string().default("white"),
  }),
]);
export type Vfx = z.infer<typeof vfxSchema>;

const overlayPosition = z.enum(["top", "center", "bottom"]).default("top");

export const overlaySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    ...timed,
    text: z.string(),
    position: overlayPosition,
    color: z.string().default("white"),
    fontSize: z.number().default(110),
  }),
  z.object({
    type: z.literal("image"),
    ...timed,
    src: z.string(),
    position: overlayPosition,
    widthPct: z.number().default(40),
  }),
]);
export type Overlay = z.infer<typeof overlaySchema>;

export const sfxSchema = z.object({
  src: z.string(),
  atMs: z.number().min(0),
  volume: z.number().min(0).default(1),
});
export type Sfx = z.infer<typeof sfxSchema>;

export const captionStyleSchema = z.object({
  position: z.enum(["top", "center", "bottom"]).default("center"),
  highlightColor: z.string().default("#ffd000"),
  fontSize: z.number().default(90),
  uppercase: z.boolean().default(true),
  maxCharsPerLine: z.number().default(18),
});
export type CaptionStyle = z.infer<typeof captionStyleSchema>;

export const clipVideoSchema = z.object({
  fps: z.number().default(30),
  width: z.number().default(1080),
  height: z.number().default(1920),
  segments: z.array(
    z.object({
      videoUrl: z.string(),
      durationMs: z.number().positive(),
      volume: z.number().min(0).default(1),
      layout: layoutSchema,
      transitionIn: transitionSchema.optional(),
      captions: z.custom<Caption[]>(),
      vfx: z.array(vfxSchema).default([]),
      overlays: z.array(overlaySchema).default([]),
      sfx: z.array(sfxSchema).default([]),
    }),
  ),
  captionStyle: captionStyleSchema.default({}),
  music: z
    .object({
      url: z.string(),
      volume: z.number().min(0).default(0.35),
      // volume while someone is talking; set equal to volume to disable ducking
      duckedVolume: z.number().min(0).default(0.1),
    })
    .optional(),
});
export type ClipVideoProps = z.infer<typeof clipVideoSchema>;
export type ClipSegment = ClipVideoProps["segments"][number];

export const msToFrames = (ms: number, fps: number) =>
  Math.round((ms / 1000) * fps);

// Global start frame of each segment, accounting for transition overlap,
// plus the total duration of the composition.
export function computeTimeline(props: ClipVideoProps) {
  const { fps } = props;
  const starts: number[] = [];
  let cursor = 0;
  props.segments.forEach((segment, i) => {
    if (i > 0 && segment.transitionIn) {
      cursor -= msToFrames(segment.transitionIn.durationMs, fps);
    }
    starts.push(cursor);
    cursor += msToFrames(segment.durationMs, fps);
  });
  return { starts, durationInFrames: Math.max(1, cursor) };
}
