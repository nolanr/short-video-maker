import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  random,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Bangers";

import { msToFrames, type Overlay, type Vfx } from "./schema";

const { fontFamily } = loadFont();

const RAMP_FRAMES = 5;

// 0..1 envelope: ramps in, holds, ramps out over [start, end)
function envelope(frame: number, start: number, end: number) {
  if (frame < start || frame >= end) return 0;
  // interpolate needs a strictly increasing input range
  const ramp = Math.min(RAMP_FRAMES, Math.floor((end - start - 1) / 2));
  if (ramp < 1) return 1;
  return interpolate(
    frame,
    [start, start + ramp, end - ramp, end],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
}

// Wraps a segment's picture and applies zoom / shake / flash effects.
export const VfxLayer: React.FC<{ vfx: Vfx[]; children: React.ReactNode }> = ({
  vfx,
  children,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  let scale = 1;
  let dx = 0;
  let dy = 0;
  const flashes: { color: string; opacity: number }[] = [];

  for (const fx of vfx) {
    const start = msToFrames(fx.atMs, fps);
    const end = start + msToFrames(fx.durationMs, fps);
    const amount = envelope(frame, start, end);
    if (amount === 0) continue;

    if (fx.type === "zoom") {
      scale *= 1 + (fx.scale - 1) * amount;
    } else if (fx.type === "shake") {
      dx += (random(`shake-x-${frame}`) - 0.5) * 2 * fx.intensity * amount;
      dy += (random(`shake-y-${frame}`) - 0.5) * 2 * fx.intensity * amount;
    } else if (fx.type === "flash") {
      // flash is sharp: full at start, fading out
      const opacity = interpolate(frame, [start, end], [1, 0], {
        extrapolateRight: "clamp",
      });
      flashes.push({ color: fx.color, opacity });
    }
  }

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill
        style={{ transform: `translate(${dx}px, ${dy}px) scale(${scale})` }}
      >
        {children}
      </AbsoluteFill>
      {flashes.map((f, i) => (
        <AbsoluteFill
          key={i}
          style={{ backgroundColor: f.color, opacity: f.opacity }}
        />
      ))}
    </AbsoluteFill>
  );
};

const PopIn: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = spring({ frame, fps, config: { damping: 12, stiffness: 200 } });
  return <div style={{ transform: `scale(${scale})` }}>{children}</div>;
};

const positionStyle = (position: Overlay["position"]): React.CSSProperties =>
  position === "top"
    ? { justifyContent: "flex-start", paddingTop: 160 }
    : position === "bottom"
      ? { justifyContent: "flex-end", paddingBottom: 200 }
      : { justifyContent: "center" };

export const Overlays: React.FC<{ overlays: Overlay[] }> = ({ overlays }) => {
  const { fps } = useVideoConfig();
  return (
    <>
      {overlays.map((overlay, i) => (
        <Sequence
          key={i}
          from={msToFrames(overlay.atMs, fps)}
          durationInFrames={Math.max(1, msToFrames(overlay.durationMs, fps))}
        >
          <AbsoluteFill
            style={{ alignItems: "center", ...positionStyle(overlay.position) }}
          >
            <PopIn>
              {overlay.type === "text" ? (
                <div
                  style={{
                    fontFamily,
                    fontSize: overlay.fontSize,
                    color: overlay.color,
                    WebkitTextStroke: "4px black",
                    textShadow: "0 6px 0 black",
                    textAlign: "center",
                    padding: "0 40px",
                  }}
                >
                  {overlay.text}
                </div>
              ) : (
                <Img
                  src={overlay.src}
                  style={{ width: `${overlay.widthPct}vw`, height: "auto" }}
                />
              )}
            </PopIn>
          </AbsoluteFill>
        </Sequence>
      ))}
    </>
  );
};
