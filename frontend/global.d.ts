declare module "*.css";

// Generated at bundle time by `frontend/auth-env-plugin.ts`; only public
// OIDC settings are exposed, never server secrets.
declare module "virtual:auth-env" {
  const env: {
    OIDC_ISSUER?: string;
    OAUTH_ISSUER?: string;
    OIDC_CLIENT_ID?: string;
    OAUTH_CLIENT_ID?: string;
    OIDC_SCOPES?: string;
  };
  export default env;
}
