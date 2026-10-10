import { loadFont } from "@remotion/google-fonts/BarlowCondensed";

import type { ScoreboardOverlay } from "./schema";

const { fontFamily } = loadFont();

export const Scoreboard: React.FC<{ overlay: ScoreboardOverlay }> = ({
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
        display: "flex",
        justifyContent: "space-between",
        padding: "16px 36px",
        background: "#111",
        color: "white",
        fontSize: 40,
        fontWeight: 800,
        letterSpacing: 1,
      }}
    >
      <span>{overlay.league ?? ""}</span>
      <span style={{ color: "#ffd000" }}>{overlay.status}</span>
    </div>
    {overlay.teams.map((team, i) => (
      <div
        key={i}
        style={{
          display: "flex",
          alignItems: "center",
          height: 150,
          borderTop: i > 0 ? "2px solid #e4e4e4" : undefined,
          color: team.winner ? "#111" : "#8a8a8a",
        }}
      >
        <div style={{ width: 22, alignSelf: "stretch", background: team.color }} />
        <div style={{ flex: 1, padding: "0 28px", minWidth: 0 }}>
          <div
            style={{
              fontSize: 68,
              fontWeight: 900,
              lineHeight: 1,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {team.name}
          </div>
          {team.note ? (
            <div style={{ fontSize: 34, fontWeight: 600, color: "#666", marginTop: 6 }}>
              {team.note}
            </div>
          ) : null}
        </div>
        <div
          style={{
            fontSize: 112,
            fontWeight: 900,
            padding: "0 36px",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {team.score}
        </div>
      </div>
    ))}
    {overlay.subtitle ? (
      <div
        style={{
          padding: "14px 36px 18px",
          borderTop: "2px solid #e4e4e4",
          color: "#555",
          fontSize: 34,
          fontWeight: 600,
          textAlign: "center",
        }}
      >
        {overlay.subtitle}
      </div>
    ) : null}
  </div>
);
