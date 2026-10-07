import seed from "./pineCatalogManifest.json";
import { sourceSha256 } from "./sourceSha256";

export const PINE_CATALOG_REPOSITORY = "everget/tradingview-pinescript-indicators";
const ROOT = "/catalog/pine/everget";
const allowedPaths = new Set(seed.entries.map((entry) => entry.path));
const sha = /^[a-f0-9]{40}$/;
const digest = /^[a-f0-9]{64}$/;
export type PineCatalogEntry = {
  id: string; path: string; name: string; author: string; license: "GPL-3.0";
  copyright: string; licenseNotice: string; pineVersion: number;
  sourceBytes: number; sourceSha256: string; upstreamBlobSha1: string; originUrl: string;
};
export type PineCatalogManifest = {
  schemaVersion: 1; repository: typeof PINE_CATALOG_REPOSITORY; upstreamCommit: string;
  lastFetchedAt: string; licenseSha256: string; entries: PineCatalogEntry[];
};
export type PineCatalogProvenance = {
  catalogId: string; repository: typeof PINE_CATALOG_REPOSITORY; path: string;
  upstreamCommit: string; upstreamBlobSha1: string; sourceSha256: string;
  originalPineVersion: number; author: string; license: "GPL-3.0";
  originUrl: string; lastFetchedAt: string;
};
export type PineCatalogImport = { source: string; provenance: PineCatalogProvenance };

export function validatePineCatalogManifest(value: unknown): PineCatalogManifest {
  if (!value || typeof value !== "object") throw new Error("Invalid Pine catalog.");
  const raw = value as PineCatalogManifest;
  if (raw.schemaVersion !== 1 || raw.repository !== PINE_CATALOG_REPOSITORY || !sha.test(raw.upstreamCommit)
    || !digest.test(raw.licenseSha256) || !Number.isFinite(Date.parse(raw.lastFetchedAt)) || !Array.isArray(raw.entries) || raw.entries.length !== seed.entries.length) throw new Error("Invalid Pine catalog revision.");
  if (raw.upstreamCommit === seed.upstreamCommit && raw.licenseSha256 !== seed.licenseSha256) throw new Error("Pinned seed catalog licence does not match the verified original.");
  const seen = new Set<string>();
  const entries = raw.entries.map((entry) => {
    if (!entry || !allowedPaths.has(entry.path) || seen.has(entry.path) || entry.id !== `community:everget:${entry.path}`
      || entry.author !== "Alex Orekhov (everget)" || entry.license !== "GPL-3.0" || !entry.copyright?.includes("Alex Orekhov (everget)") || !entry.licenseNotice?.includes("GPL-3.0")
      || typeof entry.name !== "string" || !entry.name || entry.name.length > 160 || !Number.isSafeInteger(entry.pineVersion) || entry.pineVersion < 1 || entry.pineVersion > 6
      || !Number.isSafeInteger(entry.sourceBytes) || entry.sourceBytes < 1 || entry.sourceBytes > 20_000 || !digest.test(entry.sourceSha256) || !sha.test(entry.upstreamBlobSha1)
      || entry.originUrl !== `https://github.com/${PINE_CATALOG_REPOSITORY}/blob/${raw.upstreamCommit}/${entry.path}`) throw new Error("Invalid Pine catalog entry.");
    if (raw.upstreamCommit === seed.upstreamCommit) {
      const expected = seed.entries.find((item) => item.path === entry.path)!;
      if (Object.entries(expected).some(([key, value]) => (entry as unknown as Record<string, unknown>)[key] !== value)) throw new Error("Pinned seed catalog entry does not match the verified original.");
    }
    seen.add(entry.path);
    return { ...entry };
  });
  return { schemaVersion: 1, repository: PINE_CATALOG_REPOSITORY, upstreamCommit: raw.upstreamCommit, lastFetchedAt: raw.lastFetchedAt, licenseSha256: raw.licenseSha256, entries };
}

export const CURATED_PINE_CATALOG = validatePineCatalogManifest(seed);
/** Imported copies keep the upstream base even after the user edits their source. */
export function sanitizePineCatalogProvenance(value: unknown): PineCatalogProvenance | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as PineCatalogProvenance;
  if (raw.repository !== PINE_CATALOG_REPOSITORY || !allowedPaths.has(raw.path) || raw.catalogId !== `community:everget:${raw.path}`
    || !sha.test(raw.upstreamCommit) || !sha.test(raw.upstreamBlobSha1) || !digest.test(raw.sourceSha256)
    || !Number.isSafeInteger(raw.originalPineVersion) || raw.originalPineVersion < 1 || raw.originalPineVersion > 6
    || raw.author !== "Alex Orekhov (everget)" || raw.license !== "GPL-3.0" || !Number.isFinite(Date.parse(raw.lastFetchedAt))
    || raw.originUrl !== `https://github.com/${PINE_CATALOG_REPOSITORY}/blob/${raw.upstreamCommit}/${raw.path}`) return undefined;
  if (raw.upstreamCommit === CURATED_PINE_CATALOG.upstreamCommit) {
    const entry = CURATED_PINE_CATALOG.entries.find((item) => item.path === raw.path)!;
    if (entry.sourceSha256 !== raw.sourceSha256 || entry.upstreamBlobSha1 !== raw.upstreamBlobSha1 || entry.pineVersion !== raw.originalPineVersion) return undefined;
  }
  return { catalogId: raw.catalogId, repository: PINE_CATALOG_REPOSITORY, path: raw.path, upstreamCommit: raw.upstreamCommit,
    upstreamBlobSha1: raw.upstreamBlobSha1, sourceSha256: raw.sourceSha256, originalPineVersion: raw.originalPineVersion,
    author: raw.author, license: raw.license, originUrl: raw.originUrl, lastFetchedAt: raw.lastFetchedAt };
}

export function pineCatalogCanRun(entry: PineCatalogEntry): boolean { return entry.pineVersion === 5 || entry.pineVersion === 6; }
export function pineCatalogLicenseUrl(catalog: PineCatalogManifest): string { return `${ROOT}/${catalog.upstreamCommit}/LICENSE.txt`; }

async function readText(path: string, signal: AbortSignal | undefined, limit: number): Promise<string> {
  const response = await fetch(path, { signal, credentials: "omit", redirect: "error", cache: "no-cache" });
  if (!response.ok) throw new Error("The Pine catalog source is unavailable.");
  const length = Number(response.headers.get("Content-Length"));
  if (length > limit) throw new Error("The Pine catalog response is oversized.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("This browser cannot verify the catalog response.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) { await reader.cancel(); throw new Error("The Pine catalog response is oversized."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
}

export async function loadPineCatalog(signal?: AbortSignal): Promise<PineCatalogManifest> {
  const index = JSON.parse(await readText(`${ROOT}/index.json`, signal, 32_000)) as { schemaVersion: number; repository: string; revisions: string[] };
  if (index.schemaVersion !== 1 || index.repository !== PINE_CATALOG_REPOSITORY || !Array.isArray(index.revisions) || !index.revisions.length || index.revisions.length > 256 || index.revisions.some((revision) => !sha.test(revision))) throw new Error("Invalid Pine catalog index.");
  const revision = index.revisions[index.revisions.length - 1];
  const catalog = validatePineCatalogManifest(JSON.parse(await readText(`${ROOT}/${revision}/manifest.json`, signal, 80_000)));
  if (catalog.upstreamCommit !== revision) throw new Error("Pine catalog revision does not match its index.");
  return catalog;
}

export function validatePineCatalogSource(source: string, entry: PineCatalogEntry): void {
  if (new TextEncoder().encode(source).length !== entry.sourceBytes || sourceSha256(source) !== entry.sourceSha256
    || !source.includes(entry.copyright) || !source.includes(entry.licenseNotice)
    || Number(source.match(/^[ \t\uFEFF]*\/\/@version=(\d+)/m)?.[1] ?? 1) !== entry.pineVersion) throw new Error("Pine source does not match its pinned revision, licence or version.");
}

export async function loadPineCatalogSource(catalog: PineCatalogManifest, id: string, signal?: AbortSignal): Promise<PineCatalogImport> {
  const validated = validatePineCatalogManifest(catalog);
  const entry = validated.entries.find((item) => item.id === id);
  if (!entry) throw new Error("Unknown Pine catalog entry.");
  const source = await readText(`${ROOT}/${validated.upstreamCommit}/${entry.path}`, signal, 20_000);
  validatePineCatalogSource(source, entry);
  return { source, provenance: { catalogId: entry.id, repository: PINE_CATALOG_REPOSITORY, path: entry.path, upstreamCommit: validated.upstreamCommit,
    upstreamBlobSha1: entry.upstreamBlobSha1, sourceSha256: entry.sourceSha256, originalPineVersion: entry.pineVersion, author: entry.author,
    license: entry.license, originUrl: entry.originUrl, lastFetchedAt: validated.lastFetchedAt } };
}
