import { createContext, useContext, type ReactNode } from "react";
import type { AppRecord } from "./use-app";

// The app record the layout resolved, shared with the hooks below it —
// the live feed needs the app's subject shard (`number`).
const AppContext = createContext<AppRecord | null>(null);

export function useAppRecord(): AppRecord | null {
  return useContext(AppContext);
}

export function AppRecordProvider({
  app,
  children,
}: {
  app: AppRecord | null;
  children: ReactNode;
}) {
  return <AppContext.Provider value={app}>{children}</AppContext.Provider>;
}
