import { useNavigate } from "react-router-dom";
import { Icon } from "../Icon.tsx";
import { Action } from "../Action.tsx";
import { ScreenIntro } from "../ScreenIntro.tsx";

export function Logs() {
  const navigate = useNavigate();

  return (
    <div className="screen-stack">
      <ScreenIntro
        eyebrow="LOG MANAGEMENT"
        title="Logs"
        subtitle="Structured log ingest is not part of this build yet."
      />
      <article className="panel" style={{ padding: "48px", textAlign: "center" }}>
        <div className="panel-title">No log store connected</div>
        <div className="panel-subtitle">
          This backend stores error events and transactions. Log ingestion will show up here once
          a log store is added to the backend — until then, browse stored issues instead.
        </div>
        <div className="setup-actions" style={{ justifyContent: "center", marginTop: 18 }}>
          <Action variant="primary" onClick={() => navigate("/issues")}>
            Browse issues <Icon name="chevron" size={14} />
          </Action>
        </div>
      </article>
    </div>
  );
}
