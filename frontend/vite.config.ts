import { defineConfig, type Plugin } from "vite";
import tailwindcss from "@tailwindcss/vite";

// The same public env the Bun fullstack server compiles in (bunfig.toml);
// vite builds (bun run build) resolve src/lib/auth-env.ts through this.
const PUBLIC_ENV = [
  "OIDC_ISSUER",
  "OAUTH_ISSUER",
  "OIDC_CLIENT_ID",
  "OAUTH_CLIENT_ID",
  "OIDC_SCOPES",
  // Public flag (not a secret): allows the plain-HTTP issuer opt-in below.
  "OIDC_ALLOW_INSECURE_HTTP",
] as const;

function authEnvPlugin(): Plugin {
  return {
    name: "auth-env",
    load(id) {
      if (!id.endsWith("/lib/auth-env.ts")) return undefined;
      const values: Record<string, string> = {};
      for (const key of PUBLIC_ENV) {
        const value = process.env[key];
        if (value) values[key] = value;
      }
      return `const authEnv = ${JSON.stringify(values)};\nexport default authEnv;\n`;
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), authEnvPlugin()],
});
