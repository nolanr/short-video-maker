import { AbsoluteFill, Audio, Sequence, useVideoConfig } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import type { TransitionPresentation } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { flip } from "@remotion/transitions/flip";

import { Captions } from "./Captions";
import { Overlays, VfxLayer } from "./Effects";
import { SegmentLayout } from "./Layouts";
import {
  computeTimeline,
  msToFrames,
  type ClipSegment,
  type ClipVideoProps,
  type Transition,
} from "./schema";

function presentation(
  t: Transition,
): TransitionPresentation<Record<string, unknown>> {
  switch (t.type) {
    case "slide":
      return slide({ direction: t.direction }) as never;
    case "wipe":
      return wipe({ direction: t.direction }) as never;
    case "flip":
      return flip({ direction: t.direction }) as never;
    default:
      return fade() as never;
  }
}

const Segment: React.FC<{
  segment: ClipSegment;
  captionStyle: ClipVideoProps["captionStyle"];
}> = ({ segment, captionStyle }) => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <VfxLayer vfx={segment.vfx}>
        <SegmentLayout src={segment.videoUrl} layout={segment.layout} />
      </VfxLayer>
      <Audio src={segment.videoUrl} volume={() => segment.volume} />
      <Captions captions={segment.captions} style={captionStyle} />
      <Overlays overlays={segment.overlays} />
      {segment.sfx.map((sfx, i) => (
        <Sequence key={i} from={msToFrames(sfx.atMs, fps)} layout="none">
          <Audio src={sfx.src} volume={() => sfx.volume} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

export const ClipVideo: React.FC<ClipVideoProps> = (props) => {
  const { segments, captionStyle, music, fps } = props;
  const { starts } = computeTimeline(props);

  // global frame ranges where someone is talking, used to duck the music
  const speech: [number, number][] = segments.flatMap((segment, i) =>
    segment.captions.map(
      (c) =>
        [
          starts[i] + msToFrames(c.startMs, fps),
          starts[i] + msToFrames(c.endMs, fps),
        ] as [number, number],
    ),
  );
  const DUCK_MARGIN = Math.round(fps / 4);
  const musicVolume = (f: number) => {
    if (!music) return 0;
    const talking = speech.some(
      ([s, e]) => f >= s - DUCK_MARGIN && f <= e + DUCK_MARGIN,
    );
    return talking ? music.duckedVolume : music.volume;
  };

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {music && <Audio src={music.url} loop volume={(f) => musicVolume(f)} />}
      <TransitionSeries>
        {segments.flatMap((segment, i) => {
          const items = [];
          if (i > 0 && segment.transitionIn) {
            items.push(
              <TransitionSeries.Transition
                key={`t-${i}`}
                presentation={presentation(segment.transitionIn)}
                timing={linearTiming({
                  durationInFrames: msToFrames(
                    segment.transitionIn.durationMs,
                    fps,
                  ),
                })}
              />,
            );
          }
          items.push(
            <TransitionSeries.Sequence
              key={`s-${i}`}
              durationInFrames={msToFrames(segment.durationMs, fps)}
            >
              <Segment segment={segment} captionStyle={captionStyle} />
            </TransitionSeries.Sequence>,
          );
          return items;
        })}
      </TransitionSeries>
    </AbsoluteFill>
  );
};
