import * as zarr from "zarrita";

let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

/**
 * Create a FetchStore with optional auth token injection.
 * If an auth token is set, it is passed as an X-Auth-Token header
 * via the FetchStore overrides mechanism.
 */
export function createFetchStore(
  url: string | URL,
  options: { useSuffixRequest?: boolean } = {}
): zarr.FetchStore {
  const overrides: RequestInit = {};
  if (authToken) {
    overrides.headers = { "X-Auth-Token": authToken };
  }
  return new zarr.FetchStore(url, { ...options, overrides });
}
