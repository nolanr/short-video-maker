import { loadFont } from "@remotion/google-fonts/BarlowCondensed";

import type { StatcardOverlay } from "./schema";

const { fontFamily } = loadFont();

// Same card style as Scoreboard: dark title bar, white rows, light footer.
export const Statcard: React.FC<{ overlay: StatcardOverlay }> = ({
  overlay,
}) => (
  <div
    style={{
      width: 920,
      fontFamily,
      textTransform: "uppercase",
      background: "white",
      borderRadius: 28,
      overflow: "hidden",
      boxShadow: "0 18px 60px rgba(0,0,0,0.55)",
    }}
  >
    <div
      style={{
        padding: "18px 36px",
        background: "#111",
        color: "white",
        borderBottom: `8px solid ${overlay.accent}`,
      }}
    >
      <div style={{ fontSize: 56, fontWeight: 900, lineHeight: 1.05 }}>
        {overlay.title}
      </div>
      {overlay.subtitle ? (
        <div
          style={{ fontSize: 34, fontWeight: 600, color: "#bbb", marginTop: 4 }}
        >
          {overlay.subtitle}
        </div>
      ) : null}
    </div>
    {overlay.rows.map((row, i) => (
      <div
        key={i}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 92,
          padding: "0 36px",
          borderTop: i > 0 ? "2px solid #e4e4e4" : undefined,
          background: row.highlight ? overlay.accent : undefined,
          color: "#111",
        }}
      >
        <span
          style={{
            fontSize: 44,
            fontWeight: 700,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0,
          }}
        >
          {row.label}
        </span>
        <span
          style={{
            fontSize: 64,
            fontWeight: 900,
            fontVariantNumeric: "tabular-nums",
            paddingLeft: 24,
          }}
        >
          {row.value}
        </span>
      </div>
    ))}
    {overlay.footer ? (
      <div
        style={{
          padding: "14px 36px 18px",
          borderTop: "2px solid #e4e4e4",
          color: "#555",
          fontSize: 32,
          fontWeight: 600,
          textAlign: "center",
        }}
      >
        {overlay.footer}
      </div>
    ) : null}
  </div>
);
