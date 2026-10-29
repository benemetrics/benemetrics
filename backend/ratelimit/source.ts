import { rateLimitConfig } from "./config";

/**
 * The source a request comes from.
 *
 * Behind the TLS reverse proxy the socket address is the proxy's, so the
 * trusted hop is used instead — and only the hop the proxy itself adds:
 * `X-Real-IP`, or the rightmost `X-Forwarded-For` entry. The
 * client-supplied leftmost value is never trusted.
 *
 * IPv6 addresses are bucketed by their /64 so a client cannot rotate
 * through the addresses of one prefix.
 */
export function normalizeIp(address: string): string {
  const trimmed = address.trim().toLowerCase();
  if (!trimmed.includes(":")) return trimmed;
  // IPv6: keep the first four groups (the /64) and drop the host part.
  const groups = trimmed.split("::")[0]!.split(":");
  if (groups.length < 4) return trimmed;
  return `${groups.slice(0, 4).join(":")}::/64`;
}

/**
 * The source of a request, or null when none can be attributed (an
 * in-process `app.handle` suite has no socket address). A null source is
 * never bucketed — the bucket would be shared by every unattributed
 * caller.
 */
export function clientSource(
  request: Request,
  server?: {
    requestIP?: (request: Request) => { address: string } | null;
  } | null,
): string | null {
  const socketAddress = server?.requestIP?.(request)?.address;
  if (socketAddress) return normalizeIp(socketAddress);

  if (!rateLimitConfig().trustProxy) return null;

  const realIp = request.headers.get("x-real-ip");
  if (realIp?.trim()) return normalizeIp(realIp);

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded
      .split(",")
      .map((hop) => hop.trim())
      .filter(Boolean);
    // The rightmost entry is the hop the closest proxy added.
    const hop = hops[hops.length - 1];
    if (hop) return normalizeIp(hop);
  }
  return null;
}
