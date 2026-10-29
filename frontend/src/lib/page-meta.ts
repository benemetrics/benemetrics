export function pageMeta(title: string, description: string) {
  return {
    meta: [
      { title: `${title} — Glitchlog` },
      { name: "description", content: description },
      { property: "og:title", content: `${title} — Glitchlog` },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  };
}
