export interface PlatformSymbol {
  label: string;
  className: "mobile" | "api" | "web";
}

/** Map a free-form platform name to the badge shown on app cards. */
export function platformSymbol(platform: string): PlatformSymbol {
  const value = platform.toLowerCase();
  if (value.includes("react-native") || value.includes("ios") || value.includes("android")) {
    return { label: "RN", className: "mobile" };
  }
  if (
    value.includes("node") ||
    value.includes("go") ||
    value.includes("python") ||
    value.includes("ruby") ||
    value.includes("php")
  ) {
    return { label: "API", className: "api" };
  }
  return { label: "JS", className: "web" };
}
