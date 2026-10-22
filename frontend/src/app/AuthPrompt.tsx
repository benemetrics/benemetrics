import { useEffect, useState } from "react";
import {
  AUTH_REQUIRED_EVENT,
  getAdminToken,
  setAdminToken,
} from "../lib/api";

/**
 * Shown when an API request comes back 401 and no usable identity is
 * available. With an identity provider configured the same dialog accepts a
 * provider JWT; without one the admin token is the only credential.
 */
export function AuthPrompt() {
  const [required, setRequired] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const onAuthRequired = () => setRequired(true);
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
  }, []);

  useEffect(() => {
    if (required) setDraft(getAdminToken());
  }, [required]);

  if (!required) return null;

  const save = () => {
    setAdminToken(draft.trim(), "admin");
    window.location.reload();
  };

  return (
    <div className="auth-prompt-backdrop">
      <div
        className="auth-prompt"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-prompt-title"
      >
        <h2 id="auth-prompt-title">Sign in to continue</h2>
        <p>
          Enter the admin token, or a provider JWT when an identity provider is
          configured, to continue.
        </p>
        <label className="auth-prompt-label" htmlFor="auth-prompt-token">
          Admin token
        </label>
        <input
          id="auth-prompt-token"
          className="auth-prompt-input"
          type="password"
          value={draft}
          placeholder="Bearer token"
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && save()}
        />
        <button type="button" className="auth-prompt-save" onClick={save}>
          Save &amp; reconnect
        </button>
      </div>
    </div>
  );
}
