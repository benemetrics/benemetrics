import { useEffect, useState } from "react";
import { useWorkspace } from "./WorkspaceContext";
import { ALL_ENVIRONMENTS } from "./workspace";
import type { EnvironmentDto } from "../lib/api";

export function EnvironmentSwitcher() {
  const { environments, environment, setEnvironment, createEnvironmentWithName } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const options: Array<EnvironmentDto | null> = [null, ...environments];
  const label = environment?.name ?? ALL_ENVIRONMENTS;
  const selected = (option: EnvironmentDto | null) => option?.id === environment?.id;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const create = async () => {
    const name = draft.trim();
    if (!name) return;
    await createEnvironmentWithName(name);
    setDraft("");
    setCreating(false);
    setOpen(false);
  };

  return (
    <div className="environment-wrap">
      <div
        className={`environment-switcher ${open ? "open" : ""}`}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => event.key === "Enter" && setOpen(!open)}
      >
        <span className={`env-dot ${environment?.slug ?? "all-environments"}`}></span>
        <span>{label}</span>
        <span className="caret">⌄</span>
      </div>
      {open && (
        <div className="environment-menu">
          <div className="menu-label">Environment</div>
          {options.map((option) => (
            <div
              key={option?.id ?? "all-environments"}
              className={`environment-option ${selected(option) ? "selected" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => {
                setEnvironment(option);
                setOpen(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  setEnvironment(option);
                  setOpen(false);
                }
              }}
            >
              <span className={`env-dot ${option?.slug ?? "all-environments"}`}></span>
              <span>{option?.name ?? ALL_ENVIRONMENTS}</span>
              {selected(option) && <b>✓</b>}
            </div>
          ))}
          <div className="menu-divider"></div>
          {creating ? (
            <div className="create-project-inline" onClick={(event) => event.stopPropagation()}>
              <input
                className="inline-project-input"
                placeholder="Environment name"
                value={draft}
                autoFocus
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && create()}
              />
              <div
                className="inline-create-action"
                role="button"
                tabIndex={0}
                onClick={create}
                onKeyDown={(event) => event.key === "Enter" && create()}
              >
                Create
              </div>
            </div>
          ) : (
            <div
              className="create-project-trigger"
              role="button"
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation();
                setCreating(true);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.stopPropagation();
                  setCreating(true);
                }
              }}
            >
              <span>+</span>Create new environment
            </div>
          )}
        </div>
      )}
    </div>
  );
}
