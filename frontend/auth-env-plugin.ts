import type { BunPlugin } from "bun";

// Exposes the public OIDC settings to the SPA at bundle time. Only these
// variable names ever reach the browser bundle — never reference secrets
// (ADMIN_TOKEN, client secrets, S3 credentials) from frontend code.
//
// The values are read inside `onLoad`, not at module scope: Bun test files
// set their environment before importing the app, and each file gets a fresh
// bundle build.
const PUBLIC_ENV = [
  "OIDC_ISSUER",
  "OAUTH_ISSUER",
  "OIDC_CLIENT_ID",
  "OAUTH_CLIENT_ID",
  "OIDC_SCOPES",
] as const;

export default {
  name: "auth-env",
  setup(build) {
    build.onResolve({ filter: /^virtual:auth-env$/ }, () => ({
      path: "auth-env",
      namespace: "auth-env",
    }));

    build.onLoad({ filter: /.*/, namespace: "auth-env" }, () => {
      const values: Record<string, string> = {};
      for (const key of PUBLIC_ENV) {
        const value = process.env[key];
        if (value) values[key] = value;
      }
      return {
        contents: `export default ${JSON.stringify(values)};`,
        loader: "js",
      };
    });
  },
} satisfies BunPlugin;
