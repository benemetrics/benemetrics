import type { IconName } from "./Icon";

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
];

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
