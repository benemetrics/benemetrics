// The host users reach the backend through, used to build app DSNs at
// read time so nothing deployment-specific is stored in the database.
// Behind a reverse proxy the public hostname arrives in X-Forwarded-Host
// (the proxy may chain several); otherwise the Host header is it.
export function requestHost(request: Request): string {
  const forwarded = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  return forwarded || request.headers.get("host") || "localhost";
}
