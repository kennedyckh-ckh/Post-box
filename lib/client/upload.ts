import { ApiError } from "./api";

/** Raw file upload (no JSON wrapper). The server checks the real file type, so the name is only a label. */
export async function uploadFile<T>(path: string, file: File): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method: "POST", headers: { "content-type": "application/octet-stream", "x-filename": encodeURIComponent(file.name).slice(0, 120) }, body: file, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "offline", "Cannot reach the server. Check your connection and try again.");
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* empty */
  }
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, e?.code || "error", e?.message || "The upload failed.");
  }
  return data as T;
}
