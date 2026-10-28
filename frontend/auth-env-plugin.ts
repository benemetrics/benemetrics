import type { BunPlugin } from "bun";

// Exposes the public OIDC settings to the SPA at bundle time. Only these
// variable names ever reach the browser bundle — never reference secrets
// (ADMIN_TOKEN, client secrets, S3 credentials) from frontend code.
//
// The values are read inside `onLoad`, not at module scope: Bun test files
// set their environment before importing the app, and each file gets a fresh
// bundle build.
//
// The hook replaces the real `src/lib/auth-env.ts` placeholder (a plain
// relative import), so every resolver — editors, bare `bun build` — sees a
// normal module; only served/bundled builds get the compiled env.
const PUBLIC_ENV = [
  "OIDC_ISSUER",
  "OAUTH_ISSUER",
  "OIDC_CLIENT_ID",
  "OAUTH_CLIENT_ID",
  "OIDC_SCOPES",
  // A public flag, not a secret: lets the browser's discovery read a
  // plain-HTTP issuer when the deployment opted in.
  "OIDC_ALLOW_INSECURE_HTTP",
] as const;

export default {
  name: "auth-env",
  setup(build) {
    build.onLoad({ filter: /\/lib\/auth-env\.ts$/ }, () => {
      const values: Record<string, string> = {};
      for (const key of PUBLIC_ENV) {
        const value = process.env[key];
        if (value) values[key] = value;
      }
      return {
        contents: `const authEnv = ${JSON.stringify(values)};\nexport default authEnv;\n`,
        loader: "js",
      };
    });
  },
} satisfies BunPlugin;