/**
 * Ledger Light — read-only query links.
 *
 * Links carry SQL only; browser-local workspaces, execution history, result
 * data, and credentials never leave the device. Compact links use a
 * reversible LZ-based payload and transparently fall back to standard URLs
 * whenever compression does not shorten the address.
 */

import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";

const SHARED_QUERY_PARAM = "q";
const COMPACT_SHARED_QUERY_PARAM = "qz";
export const MAX_SHARED_QUERY_LENGTH = 6_000;
export const CAUTION_SHARED_URL_LENGTH = 1_800;
export type ShareLinkMode = "standard" | "compact";

export interface SharedQueryLinkDetails {
  url: string;
  length: number;
  needsCaution: boolean;
  mode: ShareLinkMode;
}

function normalizeSharedQuery(value: string | null): string | null {
  const query = value?.trim() ?? "";
  return query.length > 0 && query.length <= MAX_SHARED_QUERY_LENGTH ? query : null;
}

function createStandardQueryUrl(query: string, baseUrl: string): string {
  const url = new URL(baseUrl);
  url.searchParams.delete(COMPACT_SHARED_QUERY_PARAM);
  url.searchParams.set(SHARED_QUERY_PARAM, query);
  return url.toString();
}

function createCompactQueryUrl(query: string, baseUrl: string): string | null {
  const compressed = compressToEncodedURIComponent(query);
  if (!compressed) return null;
  const url = new URL(baseUrl);
  url.searchParams.delete(SHARED_QUERY_PARAM);
  url.searchParams.set(COMPACT_SHARED_QUERY_PARAM, compressed);
  return url.toString();
}

export function createSharedQueryUrl(sql: string, baseUrl: string, preferredMode: ShareLinkMode = "standard"): string {
  const query = normalizeSharedQuery(sql);
  if (!query) throw new Error("Write a query before creating a share link.");
  const standardUrl = createStandardQueryUrl(query, baseUrl);
  if (preferredMode !== "compact") return standardUrl;
  const compactUrl = createCompactQueryUrl(query, baseUrl);
  return compactUrl && compactUrl.length < standardUrl.length ? compactUrl : standardUrl;
}

export function getSharedQueryLinkDetails(sql: string, baseUrl: string, preferredMode: ShareLinkMode = "standard"): SharedQueryLinkDetails {
  const url = createSharedQueryUrl(sql, baseUrl, preferredMode);
  return {
    url,
    length: url.length,
    needsCaution: url.length > CAUTION_SHARED_URL_LENGTH,
    mode: new URL(url).searchParams.has(COMPACT_SHARED_QUERY_PARAM) ? "compact" : "standard",
  };
}

export function readSharedQueryFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const compactValue = parsed.searchParams.get(COMPACT_SHARED_QUERY_PARAM);
    if (compactValue) return normalizeSharedQuery(decompressFromEncodedURIComponent(compactValue));
    return normalizeSharedQuery(parsed.searchParams.get(SHARED_QUERY_PARAM));
  } catch {
    return null;
  }
}

export function removeSharedQueryFromUrl(url: string): string {
  const next = new URL(url);
  next.searchParams.delete(SHARED_QUERY_PARAM);
  next.searchParams.delete(COMPACT_SHARED_QUERY_PARAM);
  return next.toString();
}

export async function copySharedQueryLink(sql: string, baseUrl: string, preferredMode: ShareLinkMode = "standard"): Promise<SharedQueryLinkDetails> {
  const details = getSharedQueryLinkDetails(sql, baseUrl, preferredMode);
  if (!navigator.clipboard?.writeText) {
    throw new Error("Clipboard access is unavailable. Copy the address from your browser instead.");
  }
  await navigator.clipboard.writeText(details.url);
  return details;
}
