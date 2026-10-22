import type { IconName } from "./Icon";

export interface NavItem {
  path: string;
  label: string;
  icon: IconName;
  /** Hidden for a scoped read-only identity. */
  adminOnly?: boolean;
}

export const NAV: NavItem[] = [
  { path: "/overview", label: "Overview", icon: "home" },
  { path: "/issues", label: "Issues", icon: "alert" },
  { path: "/performance", label: "Performance", icon: "activity", adminOnly: true },
  { path: "/logs", label: "Logs", icon: "logs" },
  { path: "/alerts", label: "Alerts", icon: "bell", adminOnly: true },
  { path: "/releases", label: "Releases", icon: "release", adminOnly: true },
  { path: "/feature-flags", label: "Feature flags", icon: "flag", adminOnly: true },
  { path: "/segments", label: "Segments", icon: "filter", adminOnly: true },
  { path: "/source-maps", label: "Source maps", icon: "map", adminOnly: true },
  { path: "/projects", label: "Projects", icon: "layers" },
  { path: "/permissions", label: "Permissions", icon: "shield", adminOnly: true },
];

export const MOBILE_NAV: NavItem[] = [
  { path: "/overview", label: "Overview", icon: "home" },
  { path: "/issues", label: "Issues", icon: "alert" },
  { path: "/performance", label: "Performance", icon: "activity", adminOnly: true },
  { path: "/logs", label: "Logs", icon: "logs" },
  { path: "/projects", label: "Projects", icon: "layers" },
];

/** Secondary mobile destinations, grouped behind the "More" tab. */
export const MOBILE_MORE_NAV: NavItem[] = [
  { path: "/alerts", label: "Alerts", icon: "bell", adminOnly: true },
  { path: "/releases", label: "Releases", icon: "release", adminOnly: true },
  { path: "/feature-flags", label: "Feature flags", icon: "flag", adminOnly: true },
  { path: "/segments", label: "Segments", icon: "filter", adminOnly: true },
  { path: "/source-maps", label: "Source maps", icon: "map", adminOnly: true },
  { path: "/permissions", label: "Permissions", icon: "shield", adminOnly: true },
];

export const ALL_ENVIRONMENTS = "All environments";
