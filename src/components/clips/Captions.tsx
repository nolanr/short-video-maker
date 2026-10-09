import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/BarlowCondensed";

import type { Caption } from "../../types/shorts";
import { createCaptionPages } from "../utils";
import { msToFrames, type CaptionStyle } from "./schema";

const { fontFamily } = loadFont();

// Word-highlighted captions for one segment. Caption times are segment-relative,
// and this component is rendered inside the segment's Sequence.
export const Captions: React.FC<{
  captions: Caption[];
  style: CaptionStyle;
}> = ({ captions, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const pages = createCaptionPages({
    captions,
    lineMaxLength: style.maxCharsPerLine,
    lineCount: 1,
    maxDistanceMs: 1000,
  });

  const positionStyle: React.CSSProperties =
    style.position === "top"
      ? { justifyContent: "flex-start", paddingTop: 220 }
      : style.position === "bottom"
        ? { justifyContent: "flex-end", paddingBottom: 320 }
        : { justifyContent: "center" };

  return (
    <>
      {pages.map((page, i) => (
        <Sequence
          key={i}
          from={msToFrames(page.startMs, fps)}
          durationInFrames={Math.max(
            1,
            msToFrames(page.endMs - page.startMs, fps),
          )}
          layout="none"
        >
          <AbsoluteFill style={{ alignItems: "center", ...positionStyle }}>
            {page.lines.map((line, j) => (
              <p
                key={j}
                style={{
                  margin: 0,
                  padding: "0 40px",
                  fontFamily,
                  fontSize: style.fontSize,
                  fontWeight: 900,
                  color: "white",
                  WebkitTextStroke: "3px black",
                  textShadow: "0 0 12px black",
                  textAlign: "center",
                  textTransform: style.uppercase ? "uppercase" : "none",
                }}
              >
                {line.texts.map((word, k) => {
                  const active =
                    frame >= msToFrames(word.startMs, fps) &&
                    frame <= msToFrames(word.endMs, fps);
                  return (
                    <span
                      key={k}
                      style={{
                        color: active ? style.highlightColor : "white",
                        display: "inline-block",
                        // the active word grows from its centre; the margin
                        // keeps long words from covering the space beside them
                        margin: "0 0.1em",
                        transform: active ? "scale(1.08)" : "none",
                      }}
                    >
                      {word.text.trim()}
                      {k < line.texts.length - 1 ? " " : ""}
                    </span>
                  );
                })}
              </p>
            ))}
          </AbsoluteFill>
        </Sequence>
      ))}
    </>
  );
};
