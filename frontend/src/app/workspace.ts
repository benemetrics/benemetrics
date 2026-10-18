import type { IconName } from "./Icon.tsx";

export interface NavItem {
  path: string;
  label: string;
  icon: IconName;
}

export const NAV: NavItem[] = [
  { path: "/overview", label: "Overview", icon: "home" },
  { path: "/issues", label: "Issues", icon: "alert" },
  { path: "/performance", label: "Performance", icon: "activity" },
  { path: "/logs", label: "Logs", icon: "logs" },
  { path: "/alerts", label: "Alerts", icon: "bell" },
  { path: "/releases", label: "Releases", icon: "release" },
  { path: "/feature-flags", label: "Feature flags", icon: "flag" },
  { path: "/segments", label: "Segments", icon: "filter" },
  { path: "/source-maps", label: "Source maps", icon: "map" },
  { path: "/projects", label: "Projects", icon: "layers" },
  { path: "/settings", label: "Settings", icon: "settings" },
];

// Read-only (scoped OIDC) identities only see the error-triage pages; every
// management surface stays behind the admin token.
export const READ_ONLY_NAV_PATHS = new Set([
  "/overview",
  "/issues",
  "/performance",
  "/logs",
]);

export function navForReadOnly(readOnly: boolean | undefined): NavItem[] {
  if (!readOnly) return NAV;
  return NAV.filter((item) => READ_ONLY_NAV_PATHS.has(item.path));
}

export const MOBILE_NAV: NavItem[] = [
  { path: "/overview", label: "Overview", icon: "home" },
  { path: "/issues", label: "Issues", icon: "alert" },
  { path: "/performance", label: "Performance", icon: "activity" },
  { path: "/logs", label: "Logs", icon: "logs" },
  { path: "/projects", label: "Projects", icon: "layers" },
];

/** Secondary mobile destinations, grouped behind the "More" tab. */
export const MOBILE_MORE_NAV: NavItem[] = [
  { path: "/alerts", label: "Alerts", icon: "bell" },
  { path: "/releases", label: "Releases", icon: "release" },
  { path: "/feature-flags", label: "Feature flags", icon: "flag" },
  { path: "/segments", label: "Segments", icon: "filter" },
  { path: "/source-maps", label: "Source maps", icon: "map" },
];

export const ALL_ENVIRONMENTS = "All environments";
