import { useState } from "react";

// Shown when the backend answers 401: the admin token is the master
// credential (backend/auth.ts); verified provider JWT identities arrive via
// the OIDC login flow (wired with the provider feature — the session hook
// already accepts an idToken credential).
export function TokenPrompt({
  onSubmit,
}: {
  onSubmit: (token: string) => Promise<boolean>;
}) {
  const [token, setToken] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim() || busy) return;
    setBusy(true);
    const ok = await onSubmit(token);
    setBusy(false);
    if (!ok) {
      setInvalid(true);
      setToken("");
    }
  };

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <form onSubmit={submit} className="panel w-full max-w-md p-6">
        <h1 className="font-mono text-sm text-muted-foreground">// auth required</h1>
        <h2 className="mt-2 text-xl font-bold tracking-tight">Sign in to Glitchlog</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Paste the admin token printed in the server log. OIDC identities sign in with their provider instead.
        </p>
        <input
          type="password"
          name="token"
          autoFocus
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="bnm_xxxxxx-xxxxxx-xxxxxx-xxxxxx"
          className="mt-4 w-full rounded-md border bg-input px-3 py-2 font-mono text-sm"
        />
        {invalid && <p className="mt-2 text-sm text-destructive">That token was rejected. Try again.</p>}
        <button
          type="submit"
          disabled={busy}
          className="mt-4 w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? "Checking…" : "Continue"}
        </button>
      </form>
    </div>
  );
}
