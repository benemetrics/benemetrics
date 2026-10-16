import { useEffect, useState } from "react";
import { useWorkspace } from "./WorkspaceContext";

export function ProjectMenu({ className = "", onSelect }: { className?: string; onSelect?: () => void }) {
  const { projects, project, selectProject, createProjectWithName } = useWorkspace();
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");

  const create = async () => {
    const name = draft.trim();
    if (!name) return;
    await createProjectWithName(name);
    setDraft("");
    setCreating(false);
    onSelect?.();
  };

  return (
    <div className={`project-menu ${className}`.trim()}>
      <div className="menu-label">Switch project</div>
      {projects.map((item) => (
        <div
          key={item.id}
          className={`project-option ${project?.id === item.id ? "selected" : ""}`}
          role="button"
          tabIndex={0}
          onClick={() => {
            selectProject(item.id);
            onSelect?.();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              selectProject(item.id);
              onSelect?.();
            }
          }}
        >
          <div className="project-option-icon">{item.name.slice(0, 1)}</div>
          <span>{item.name}</span>
          {project?.id === item.id && <b>✓</b>}
        </div>
      ))}
      {projects.length === 0 && (
        <div className="project-option">
          <div className="project-option-icon">—</div>
          <span>No projects yet</span>
        </div>
      )}
      <div className="menu-divider"></div>
      {creating ? (
        <div className="create-project-inline" onClick={(event) => event.stopPropagation()}>
          <input
            className="inline-project-input"
            placeholder="Project name"
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
          <span>+</span>Create new project
        </div>
      )}
    </div>
  );
}

export function ProjectSwitcher() {
  const { project } = useWorkspace();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="project-switcher-wrap">
      <div
        className={`project-switcher ${open ? "open" : ""}`}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => event.key === "Enter" && setOpen(!open)}
      >
        <div className="project-avatar">{(project?.name ?? "?").slice(0, 1)}</div>
        <div>
          <span>Project</span>
          <strong>{project?.name ?? "No project"}</strong>
        </div>
        <span className="switcher-caret">⌄</span>
      </div>
      {open && <ProjectMenu onSelect={() => setOpen(false)} />}
    </div>
  );
}
