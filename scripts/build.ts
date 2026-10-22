/**
 * The production bundle: the API plus the frontend it serves.
 *
 * `bun build` does not apply the bunfig plugins, so the virtual module that
 * carries the public OIDC settings to the browser is registered here. The
 * `crypto` builtin stays external: the browser bundle only reaches it in a
 * branch the WebCrypto path never takes.
 */
import authEnvPlugin from "../frontend/auth-env-plugin";

const result = await Bun.build({
  entrypoints: ["./backend/index.ts"],
  outdir: "dist",
  target: "bun",
  minify: true,
  plugins: [authEnvPlugin],
  external: ["crypto"],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
