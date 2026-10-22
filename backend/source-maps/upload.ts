import { badRequest, payloadTooLarge } from "backend/errors";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export interface SourceMapUpload {
  filename: string;
  dist: string | null;
  mapJson: string;
}

// Reads the multipart upload: the `.map` file, the artifact name and the
// optional dist. The file must be a version 3 source map.
export async function readSourceMapUpload(form: FormData): Promise<SourceMapUpload> {
  const [file, name] = [form.get("file"), form.get("name")];
  if (!file || typeof file === "string" || !name || typeof name !== "string") {
    throw badRequest("Multipart upload requires 'file' and 'name' fields");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw payloadTooLarge("Source map exceeds the 10 MB limit");
  }

  const mapJson = await file.text();
  let map: { version?: unknown; sources?: unknown; mappings?: unknown };
  try {
    map = JSON.parse(mapJson) as typeof map;
  } catch {
    throw badRequest("Uploaded file is not valid JSON");
  }
  if (
    map.version !== 3 ||
    !Array.isArray(map.sources) ||
    typeof map.mappings !== "string"
  ) {
    throw badRequest(
      "Invalid source map: expected version 3 with sources and mappings",
    );
  }

  const dist = form.get("dist");
  return {
    filename: name,
    dist: typeof dist === "string" ? dist : null,
    mapJson,
  };
}
