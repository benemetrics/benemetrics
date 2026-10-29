// Placeholder for the public OIDC settings. The bundler plugins
// (bunfig [serve.static] -> frontend/auth-env-plugin.ts, and vite.config.ts)
// replace these contents with the compiled env at bundle time — only those
// public variable names ever reach the browser bundle, never secrets.
const authEnv: Record<string, string | undefined> = {};
export default authEnv;
