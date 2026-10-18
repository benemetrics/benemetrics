import { useState } from "react";
import { setAdminToken } from "../lib/api.ts";
import { useWorkspace } from "./WorkspaceContext.tsx";

// Prompts for the admin token when the admin API rejected the caller:
// no identity provider is configured, the OIDC identity has no read
// grant, or the token is missing/invalid. The admin token is the fallback
// credential in every case (it is also the only way to manage projects).
export function AuthPrompt() {
  const { authPrompt, dismissAuthPrompt } = useWorkspace();
  const [draft, setDraft] = useState("");

  if (!authPrompt) return null;

  const save = () => {
    setAdminToken(draft.trim());
    window.location.reload();
  };

  return (
    <div className="auth-prompt" role="status">
      <div className="auth-prompt-copy">
        <strong>Sign in to continue.</strong>
        <span>
          Your group has no read permission yet — ask an admin to grant it in
          Settings → Permissions, or paste the admin token to unlock the
          workspace.
        </span>
      </div>
      <input
        className="token-input"
        type="password"
        value={draft}
        placeholder="Admin token"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => event.key === "Enter" && save()}
      />
      <div
        className="token-save"
        role="button"
        tabIndex={0}
        onClick={save}
        onKeyDown={(event) => event.key === "Enter" && save()}
      >
        Save
      </div>
      <div
        className="auth-prompt-dismiss"
        role="button"
        tabIndex={0}
        onClick={dismissAuthPrompt}
        onKeyDown={(event) => event.key === "Enter" && dismissAuthPrompt()}
      >
        Dismiss
      </div>
    </div>
  );
}
