/**
 * base.ts — Core fetch wrapper for the Catalyst API.
 *
 * All API calls go through `fetchApi<T>`. It handles:
 *   - CSRF token injection on mutating requests (POST/PATCH/PUT/DELETE)
 *   - Content-Type header for JSON bodies
 *   - Typed error throwing via `ApiError` on non-2xx responses
 *
 * The backend runs at localhost:8000 in dev; Vite proxies /api/* to it.
 * In production, /api/* routes to the same origin (Railway).
 */

/** Reads the value of a named cookie from document.cookie. */
function getCookie(name: string): string {
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split("=")[1]) : "";
}

/** HTTP methods that require a CSRF token. */
const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/** Thrown whenever the API returns a non-2xx status code. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface FetchOptions extends Omit<RequestInit, "body"> {
  /** Parsed JSON body — will be serialized and the Content-Type header set. */
  body?: unknown;
  /**
   * When true, the response is returned as a Blob (use for PDF/file downloads).
   * `fetchApi` still throws `ApiError` on non-2xx, but resolves with the blob
   * on success. The generic T should be `Blob` at the call site.
   */
  blob?: boolean;
}

/**
 * Core fetch wrapper. Every API function in this module calls this.
 *
 * @param path   - URL path, e.g. `/api/cases/` or `/api/cases/${id}/findings/`
 * @param options - Standard fetch options plus `body` (object) and `blob` flag
 * @returns Parsed JSON as T, or a Blob when `options.blob` is true
 */
export async function fetchApi<T>(
  path: string,
  options: FetchOptions = {}
): Promise<T> {
  const { body, blob: wantBlob, method = "GET", headers: extraHeaders, ...rest } = options;

  const headers: Record<string, string> = {};

  // Merge any caller-supplied headers
  if (extraHeaders) {
    Object.entries(extraHeaders as Record<string, string>).forEach(
      ([k, v]) => (headers[k] = v)
    );
  }

  // JSON body + CSRF for mutating methods
  let serializedBody: BodyInit | undefined;
  if (body !== undefined) {
    serializedBody = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
  }

  if (MUTATING_METHODS.has(method.toUpperCase())) {
    const csrf = getCookie("csrftoken");
    if (csrf) {
      headers["X-CSRFToken"] = csrf;
    }
  }

  const response = await fetch(path, {
    method,
    headers,
    body: serializedBody,
    ...rest,
  });

  if (!response.ok) {
    // Attempt to extract a message from the error body
    let message = `${response.status} ${response.statusText}`;
    try {
      const errBody = await response.json();
      // Django REST Framework wraps errors in { detail: "..." } or { field: [...] }
      if (typeof errBody?.detail === "string") {
        message = errBody.detail;
      } else if (typeof errBody === "object" && errBody !== null) {
        // Flatten first error found in DRF field-level errors
        const firstField = Object.keys(errBody)[0];
        const firstMsg = errBody[firstField];
        if (Array.isArray(firstMsg) && typeof firstMsg[0] === "string") {
          message = `${firstField}: ${firstMsg[0]}`;
        }
      }
    } catch {
      // Non-JSON error body — keep the status text message
    }
    throw new ApiError(response.status, message);
  }

  // 204 No Content — return undefined cast to T
  if (response.status === 204) {
    return undefined as unknown as T;
  }

  if (wantBlob) {
    return response.blob() as unknown as Promise<T>;
  }

  return response.json() as Promise<T>;
}
