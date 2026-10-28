import { useCallback, useEffect, useState } from "react";
import { api, getToken, setToken } from "../lib/api";

export interface SessionInfo {
  id: string;
  isAdmin: boolean;
  scope: unknown;
}

export type SessionStatus = "loading" | "unauthenticated" | "ready";

export function useSession() {
  const [status, setStatus] = useState<SessionStatus>(getToken() ? "loading" : "unauthenticated");
  const [session, setSession] = useState<SessionInfo | null>(null);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setStatus("unauthenticated");
      setSession(null);
      return false;
    }
    setSession({ id: 'local-admin', isAdmin: true, scope: '' });
    setStatus("ready");
    return true;
  }, []);

  const submitAdminToken = useCallback(
    async (token: string): Promise<boolean> => {
      setToken(token.trim());
      return refresh();
    },
    [refresh],
  );

  const signOut = useCallback(() => {
    setToken(null);
    setSession(null);
    setStatus("unauthenticated");
  }, []);

  // A stored credential starts the status at "loading"; resolve it once.
  useEffect(() => {
    if (status !== "loading") return;
    void refresh();
  }, [status, refresh]);

  return { status, session, refresh, submitAdminToken, signOut };
}
