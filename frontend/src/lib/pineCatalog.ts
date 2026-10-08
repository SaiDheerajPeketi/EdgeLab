import legacySeed from "./pineCatalogManifest.json";
import seed from "./pineCatalogManifestV2.json";
import migrations from "./pineCatalogMigrations.json";
import { sourceSha256 } from "./sourceSha256";

export const PINE_CATALOG_REPOSITORY = "everget/tradingview-pinescript-indicators";
const ROOT = "/catalog/pine/everget-v2";
const LEGACY_ROOT = "/catalog/pine/everget";
const allowedPaths = new Set(seed.entries.map((entry) => entry.path));
const legacyPaths = new Set(legacySeed.entries.map((entry) => entry.path));

// Collection membership is exact; partial, mixed and duplicate sets never select a root.
function collectionSeed(entries: PineCatalogEntry[]) {
  const paths = new Set(entries.map((entry) => entry?.path));
  if (paths.size !== entries.length) throw new Error("Invalid Pine catalog collection.");
  if (entries.length === seed.entries.length && [...paths].every((path) => allowedPaths.has(path))) return seed;
  if (entries.length === legacySeed.entries.length && [...paths].every((path) => legacyPaths.has(path))) return legacySeed;
  throw new Error("Invalid Pine catalog collection.");
}

function catalogRoot(catalog: PineCatalogManifest): string {
  return collectionSeed(validatePineCatalogManifest(catalog).entries) === legacySeed ? LEGACY_ROOT : ROOT;
}
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
  collection?: "expanded-v2";
  upstreamCommit: string; upstreamBlobSha1: string; sourceSha256: string;
  originalPineVersion: number; author: string; license: "GPL-3.0";
  originUrl: string; lastFetchedAt: string;
  migration?: { id: string; version: 5; sourceSha256: string };
};
export type PineCatalogImport = { source: string; provenance: PineCatalogProvenance };
export type PineCatalogMigration = {
  id: string; catalogId: string; path: string; upstreamCommit: string; originalSourceSha256: string;
  originalPineVersion: number; upstreamBlobSha1: string;
  targetVersion: 5; sourcePath: string; sourceBytes: number; sourceSha256: string;
};

/** Derivatives are compiled pins, never selected from a remotely refreshed manifest. */
export function pineCatalogMigration(catalog: PineCatalogManifest, id: string): PineCatalogMigration | undefined {
  const entry = validatePineCatalogManifest(catalog).entries.find((item) => item.id === id);
  if (!entry || pineCatalogCanRun(entry)) return undefined;
  const migration = migrations.entries.find((item) => item.targetVersion === 5 && item.catalogId === id && item.path === entry.path
    && item.upstreamCommit === catalog.upstreamCommit && item.originalSourceSha256 === entry.sourceSha256
    && item.originalPineVersion === entry.pineVersion && item.upstreamBlobSha1 === entry.upstreamBlobSha1);
  return migration ? { ...migration, targetVersion: 5 } : undefined;
}

export function validatePineCatalogManifest(value: unknown): PineCatalogManifest {
  if (!value || typeof value !== "object") throw new Error("Invalid Pine catalog.");
  const raw = value as PineCatalogManifest;
  if (raw.schemaVersion !== 1 || raw.repository !== PINE_CATALOG_REPOSITORY || !sha.test(raw.upstreamCommit)
    || !digest.test(raw.licenseSha256) || !Number.isFinite(Date.parse(raw.lastFetchedAt)) || !Array.isArray(raw.entries)) throw new Error("Invalid Pine catalog revision.");
  const selectedSeed = collectionSeed(raw.entries);
  if (raw.upstreamCommit === selectedSeed.upstreamCommit && raw.licenseSha256 !== selectedSeed.licenseSha256) throw new Error("Pinned seed catalog licence does not match the verified original.");
  const seen = new Set<string>();
  const entries = raw.entries.map((entry) => {
    if (!entry || !allowedPaths.has(entry.path) || seen.has(entry.path) || entry.id !== `community:everget:${entry.path}`
      || entry.author !== "Alex Orekhov (everget)" || entry.license !== "GPL-3.0" || !entry.copyright?.includes("Alex Orekhov (everget)") || !entry.licenseNotice?.includes("GPL-3.0")
      || typeof entry.name !== "string" || !entry.name || entry.name.length > 160 || !Number.isSafeInteger(entry.pineVersion) || entry.pineVersion < 1 || entry.pineVersion > 6
      || !Number.isSafeInteger(entry.sourceBytes) || entry.sourceBytes < 1 || entry.sourceBytes > 20_000 || !digest.test(entry.sourceSha256) || !sha.test(entry.upstreamBlobSha1)
      || entry.originUrl !== `https://github.com/${PINE_CATALOG_REPOSITORY}/blob/${raw.upstreamCommit}/${entry.path}`) throw new Error("Invalid Pine catalog entry.");
    if (raw.upstreamCommit === selectedSeed.upstreamCommit) {
      const expected = selectedSeed.entries.find((item) => item.path === entry.path)!;
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
  const selectedSeed = raw.collection === "expanded-v2" ? seed : legacySeed;
  if (raw.collection !== undefined && raw.collection !== "expanded-v2") return undefined;
  if (raw.repository !== PINE_CATALOG_REPOSITORY || !selectedSeed.entries.some((entry) => entry.path === raw.path) || raw.catalogId !== `community:everget:${raw.path}`
    || !sha.test(raw.upstreamCommit) || !sha.test(raw.upstreamBlobSha1) || !digest.test(raw.sourceSha256)
    || !Number.isSafeInteger(raw.originalPineVersion) || raw.originalPineVersion < 1 || raw.originalPineVersion > 6
    || raw.author !== "Alex Orekhov (everget)" || raw.license !== "GPL-3.0" || !Number.isFinite(Date.parse(raw.lastFetchedAt))
    || raw.originUrl !== `https://github.com/${PINE_CATALOG_REPOSITORY}/blob/${raw.upstreamCommit}/${raw.path}`) return undefined;
  if (raw.upstreamCommit === selectedSeed.upstreamCommit) {
    const entry = selectedSeed.entries.find((item) => item.path === raw.path)!;
    if (entry.sourceSha256 !== raw.sourceSha256 || entry.upstreamBlobSha1 !== raw.upstreamBlobSha1 || entry.pineVersion !== raw.originalPineVersion) return undefined;
  }
  let migration: PineCatalogProvenance["migration"];
  if (raw.migration !== undefined) {
    const pinned = migrations.entries.find((item) => item.targetVersion === 5 && item.catalogId === raw.catalogId && item.path === raw.path
      && item.upstreamCommit === raw.upstreamCommit && item.originalSourceSha256 === raw.sourceSha256
      && item.upstreamBlobSha1 === raw.upstreamBlobSha1 && item.originalPineVersion === raw.originalPineVersion
      && raw.migration && raw.migration.id === item.id && raw.migration.version === 5
      && raw.migration.sourceSha256 === item.sourceSha256);
    if (pinned) {
      migration = { id: pinned.id, version: 5, sourceSha256: pinned.sourceSha256 };
    }
  }
  return { catalogId: raw.catalogId, repository: PINE_CATALOG_REPOSITORY, path: raw.path, upstreamCommit: raw.upstreamCommit,
    ...(raw.collection ? { collection: raw.collection } : {}),
    upstreamBlobSha1: raw.upstreamBlobSha1, sourceSha256: raw.sourceSha256, originalPineVersion: raw.originalPineVersion,
    author: raw.author, license: raw.license, originUrl: raw.originUrl, lastFetchedAt: raw.lastFetchedAt,
    ...(migration ? { migration } : {}) };
}

export function pineCatalogCanRun(entry: PineCatalogEntry): boolean { return entry.pineVersion === 5 || entry.pineVersion === 6; }
export function pineCatalogLicenseUrl(catalog: PineCatalogManifest): string { return `${catalogRoot(catalog)}/${catalog.upstreamCommit}/LICENSE.txt`; }
export function pineCatalogProvenanceLicenseUrl(value: PineCatalogProvenance): string {
  const origin = sanitizePineCatalogProvenance(value);
  if (!origin) throw new Error("Invalid Pine catalog provenance.");
  return `${origin.collection === "expanded-v2" ? ROOT : LEGACY_ROOT}/${origin.upstreamCommit}/LICENSE.txt`;
}

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
  const index = JSON.parse(await readText(`${ROOT}/index.json`, signal, 32_000)) as { schemaVersion: number; repository: string; revisions: string[]; currentRevision?: unknown };
  if (!index || typeof index !== "object" || Array.isArray(index) || index.schemaVersion !== 1 || index.repository !== PINE_CATALOG_REPOSITORY || !Array.isArray(index.revisions) || !index.revisions.length || index.revisions.length > 256 || index.revisions.some((revision) => typeof revision !== "string" || !sha.test(revision)) || new Set(index.revisions).size !== index.revisions.length) throw new Error("Invalid Pine catalog index.");
  const hasCurrent = Object.prototype.hasOwnProperty.call(index, "currentRevision");
  if (hasCurrent && (typeof index.currentRevision !== "string" || !sha.test(index.currentRevision) || !index.revisions.includes(index.currentRevision))) throw new Error("Invalid Pine catalog current revision.");
  // Older indexes use append order; new indexes can explicitly select any
  // verified archive without changing its source or saved user copies.
  const revision = hasCurrent ? index.currentRevision as string : index.revisions[index.revisions.length - 1];
  const catalog = validatePineCatalogManifest(JSON.parse(await readText(`${ROOT}/${revision}/manifest.json`, signal, 80_000)));
  if (catalog.upstreamCommit !== revision || catalogRoot(catalog) !== ROOT) throw new Error("Pine catalog revision does not match its index.");
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
  const source = await readText(`${catalogRoot(validated)}/${validated.upstreamCommit}/${entry.path}`, signal, 20_000);
  validatePineCatalogSource(source, entry);
  return { source, provenance: { catalogId: entry.id, repository: PINE_CATALOG_REPOSITORY, path: entry.path, upstreamCommit: validated.upstreamCommit,
    ...(catalogRoot(validated) === ROOT ? { collection: "expanded-v2" as const } : {}),
    upstreamBlobSha1: entry.upstreamBlobSha1, sourceSha256: entry.sourceSha256, originalPineVersion: entry.pineVersion, author: entry.author,
    license: entry.license, originUrl: entry.originUrl, lastFetchedAt: validated.lastFetchedAt } };
}

/** Recover an immutable saved base directly; the current catalog selection is irrelevant. */
export async function loadPineCatalogOriginal(provenance: PineCatalogProvenance, signal?: AbortSignal): Promise<PineCatalogImport> {
  const origin = sanitizePineCatalogProvenance(provenance);
  if (!origin) throw new Error("Invalid Pine catalog provenance.");
  const root = origin.collection === "expanded-v2" ? ROOT : LEGACY_ROOT;
  const catalog = validatePineCatalogManifest(JSON.parse(await readText(`${root}/${origin.upstreamCommit}/manifest.json`, signal, 80_000)));
  if (catalog.upstreamCommit !== origin.upstreamCommit || catalogRoot(catalog) !== root) throw new Error("The archived Pine catalog does not match the saved original.");
  const entry = catalog.entries.find((item) => item.id === origin.catalogId);
  if (!entry || entry.path !== origin.path || entry.sourceSha256 !== origin.sourceSha256 || entry.upstreamBlobSha1 !== origin.upstreamBlobSha1
    || entry.pineVersion !== origin.originalPineVersion || entry.author !== origin.author || entry.license !== origin.license
    || entry.originUrl !== origin.originUrl || catalog.lastFetchedAt !== origin.lastFetchedAt) throw new Error("The archived Pine source does not match the saved provenance.");
  const original = await loadPineCatalogSource(catalog, origin.catalogId, signal);
  for (const [key, value] of Object.entries(origin)) {
    // A derivative pin identifies the edited base, not the original being recovered.
    if (key !== "migration" && original.provenance[key as keyof PineCatalogProvenance] !== value) throw new Error("The archived Pine source does not match the saved provenance.");
  }
  return original;
}

/** An explicit import verifies both the original and the separately pinned derivative. */
export async function loadPineCatalogMigration(catalog: PineCatalogManifest, id: string, signal?: AbortSignal): Promise<PineCatalogImport> {
  const migration = pineCatalogMigration(catalog, id);
  if (!migration) throw new Error("No reviewed migration matches this original source revision.");
  const original = await loadPineCatalogSource(catalog, id, signal);
  const entry = catalog.entries.find((item) => item.id === id)!;
  const source = await readText(migration.sourcePath, signal, 20_000);
  validatePineCatalogSource(source, { ...entry, pineVersion: migration.targetVersion,
    sourceBytes: migration.sourceBytes, sourceSha256: migration.sourceSha256 });
  return { source, provenance: { ...original.provenance,
    migration: { id: migration.id, version: migration.targetVersion, sourceSha256: migration.sourceSha256 } } };
}
