import { AbsoluteFill, OffthreadVideo, useVideoConfig } from "remotion";
import {
  SOURCE_HEIGHT,
  SOURCE_WIDTH,
  type CropRect,
  type Layout,
} from "./schema";

const FULL: CropRect = { x: 0, y: 0, w: 1, h: 1 };

// Shows `crop` of the source so that it covers a box of boxWidth x boxHeight,
// centered. Video elements are always muted; segment audio is a separate <Audio>.
const CropBox: React.FC<{
  src: string;
  crop: CropRect;
  boxWidth: number;
  boxHeight: number;
  style?: React.CSSProperties;
}> = ({ src, crop, boxWidth, boxHeight, style }) => {
  const cropW = crop.w * SOURCE_WIDTH;
  const cropH = crop.h * SOURCE_HEIGHT;
  const scale = Math.max(boxWidth / cropW, boxHeight / cropH);
  const left = -crop.x * SOURCE_WIDTH * scale + (boxWidth - cropW * scale) / 2;
  const top = -crop.y * SOURCE_HEIGHT * scale + (boxHeight - cropH * scale) / 2;

  return (
    <div
      style={{
        position: "relative",
        width: boxWidth,
        height: boxHeight,
        overflow: "hidden",
        ...style,
      }}
    >
      <OffthreadVideo
        src={src}
        muted
        style={{
          position: "absolute",
          left,
          top,
          width: SOURCE_WIDTH * scale,
          height: SOURCE_HEIGHT * scale,
        }}
      />
    </div>
  );
};

export const SegmentLayout: React.FC<{ src: string; layout: Layout }> = ({
  src,
  layout,
}) => {
  const { width, height } = useVideoConfig();

  if (layout.type === "fill") {
    return (
      <CropBox
        src={src}
        crop={layout.crop ?? FULL}
        boxWidth={width}
        boxHeight={height}
      />
    );
  }

  if (layout.type === "blur") {
    const crop = layout.crop ?? FULL;
    const fgHeight = Math.round(
      (width * (crop.h * SOURCE_HEIGHT)) / (crop.w * SOURCE_WIDTH),
    );
    // CSS blur on a full 1080x1920 layer is very slow in headless Chrome, so
    // blur a small copy and scale it up instead
    const BG_SCALE = 8;
    return (
      <AbsoluteFill style={{ backgroundColor: "black" }}>
        <CropBox
          src={src}
          crop={crop}
          boxWidth={Math.ceil(width / BG_SCALE)}
          boxHeight={Math.ceil(height / BG_SCALE)}
          style={{
            filter: "blur(4px) brightness(0.6)",
            transform: `scale(${BG_SCALE * 1.1})`,
            transformOrigin: "top left",
            marginLeft: -width * 0.05,
            marginTop: -height * 0.05,
          }}
        />
        <AbsoluteFill style={{ justifyContent: "center" }}>
          <CropBox
            src={src}
            crop={crop}
            boxWidth={width}
            boxHeight={fgHeight}
          />
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }

  const camHeight = Math.round(height * layout.camHeight);
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <CropBox
        src={src}
        crop={layout.cam}
        boxWidth={width}
        boxHeight={camHeight}
      />
      <CropBox
        src={src}
        crop={layout.game}
        boxWidth={width}
        boxHeight={height - camHeight}
      />
    </AbsoluteFill>
  );
};
