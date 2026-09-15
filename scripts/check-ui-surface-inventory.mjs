import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = path.resolve(path.dirname(MODULE_PATH), "..");
const REQUIRED_VIEWPORTS = ["mobile", "tablet", "desktop"];

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function read(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function listFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(target));
    else files.push(target);
  }
  return files;
}

function unique(values) {
  return [...new Set(values)];
}

function sameKeys(left, right) {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

export function routePatternCovers(pattern, route) {
  if (pattern === route) return true;
  if (!pattern.includes(":")) return false;
  const patternParts = pattern.split("/");
  const routeParts = route.split("/");
  return patternParts.length === routeParts.length
    && patternParts.every((part, index) => part.startsWith(":") || part === routeParts[index]);
}

export function discoverRouteDefinitions(appRoutesSource, workspaceRouteSource) {
  const appRoutes = [...appRoutesSource.matchAll(/<Route\b[^>]*\bpath="([^"]+)"/g)]
    .map((match) => match[1]);
  const workspacePrefixes = [...workspaceRouteSource.matchAll(/\[\s*"(\/app[^"]*)"\s*,/g)]
    .map((match) => match[1]);
  const canonicalWorkspaceRoutes = [...workspaceRouteSource.matchAll(/return\s+"(\/app[^"]*)"/g)]
    .map((match) => match[1]);
  return unique([...appRoutes, ...workspacePrefixes, ...canonicalWorkspaceRoutes]).sort();
}

export function discoverPlaywrightProjects(playwrightSource) {
  const projects = new Map();
  for (const match of playwrightSource.matchAll(/name:\s*"([^"]+)"[\s\S]{0,600}?viewport:\s*\{\s*height:\s*(\d+),\s*width:\s*(\d+)/g)) {
    projects.set(match[1], { height: Number(match[2]), width: Number(match[3]) });
  }
  return projects;
}

function validateNamedSurfaceFamily({
  dispositions,
  errors,
  names,
  root,
  sources,
  validDispositions,
  family,
}) {
  const expected = [...names].sort();
  const dispositionKeys = Object.keys(dispositions ?? {}).sort();
  const sourceKeys = Object.keys(sources ?? {}).sort();
  if (!sameKeys(expected, dispositionKeys)) {
    errors.push(`${family} disposition keys must exactly match the inventoried ${family} names.`);
  }
  if (!sameKeys(expected, sourceKeys)) {
    errors.push(`${family} source-evidence keys must exactly match the inventoried ${family} names.`);
  }
  for (const name of names) {
    if (!validDispositions.has(dispositions?.[name])) {
      errors.push(`${family} "${name}" has no valid retain/restyle/restructure/replace decision.`);
    }
    if (!Array.isArray(sources?.[name]) || sources[name].length === 0) {
      errors.push(`${family} "${name}" has no source evidence.`);
      continue;
    }
    for (const source of sources[name]) {
      if (!fs.existsSync(path.join(root, source))) {
        errors.push(`${family} "${name}" source does not exist: ${source}.`);
      }
    }
  }
}

export function validateUiSurfaceInventory({
  inventory,
  appRoutesSource,
  workspaceRouteSource,
  playwrightSource,
  snapshotFiles,
  root = DEFAULT_ROOT,
}) {
  const errors = [];
  const gaps = [];
  const validDispositions = new Set(inventory.classification ?? []);
  const routes = Array.isArray(inventory.routes) ? inventory.routes : [];
  const routePaths = routes.map((route) => route.path);
  const uniqueRoutePaths = unique(routePaths);

  if (inventory.schemaVersion !== 2) errors.push("UI surface inventory schemaVersion must be 2.");
  if (validDispositions.size !== 4) errors.push("Inventory must declare all four surface decisions.");
  if (routePaths.length !== uniqueRoutePaths.length) errors.push("Inventory route paths must be unique.");

  const discoveredRoutes = discoverRouteDefinitions(appRoutesSource, workspaceRouteSource);
  for (const route of discoveredRoutes) {
    if (!routePaths.some((pattern) => routePatternCovers(pattern, route))) {
      errors.push(`Route definition is missing from the surface inventory: ${route}.`);
    }
  }

  const projects = discoverPlaywrightProjects(playwrightSource);
  const viewports = inventory.viewportBaselines ?? {};
  for (const viewport of REQUIRED_VIEWPORTS) {
    if (!viewports[viewport]) errors.push(`Missing required responsive viewport: ${viewport}.`);
  }
  for (const [name, baseline] of Object.entries(viewports)) {
    if (!Number.isInteger(baseline.width) || baseline.width <= 0) {
      errors.push(`Viewport "${name}" must declare a positive integer width.`);
    }
    if (baseline.project) {
      const project = projects.get(baseline.project);
      if (!project) errors.push(`Viewport "${name}" references missing Playwright project "${baseline.project}".`);
      else if (project.width !== baseline.width) {
        errors.push(`Viewport "${name}" declares ${baseline.width}px but Playwright "${baseline.project}" uses ${project.width}px.`);
      }
    } else if (baseline.status !== "gap" || !baseline.reason) {
      errors.push(`Viewport "${name}" without a Playwright project must record a gap reason.`);
    }
    if (baseline.status === "gap") gaps.push(`viewport:${name}: ${baseline.reason}`);
  }

  for (const route of routes) {
    const prefix = `Route "${route.path}"`;
    if (!route.path || !route.surface) errors.push(`${prefix} must declare path and surface.`);
    if (typeof route.auth !== "boolean") errors.push(`${prefix} must declare auth as a boolean.`);
    if (!validDispositions.has(route.disposition)) errors.push(`${prefix} has no valid surface decision.`);
    if (!Array.isArray(route.responsiveWidths) || route.responsiveWidths.length === 0) {
      errors.push(`${prefix} has no responsive-width contract.`);
    } else {
      for (const viewport of REQUIRED_VIEWPORTS) {
        if (!route.responsiveWidths.includes(viewport)) errors.push(`${prefix} is missing the ${viewport} responsive width.`);
      }
      for (const viewport of route.responsiveWidths) {
        if (!viewports[viewport]) errors.push(`${prefix} references unknown responsive width "${viewport}".`);
      }
    }
    if (!Array.isArray(route.states) || route.states.length === 0) {
      errors.push(`${prefix} has no state inventory.`);
    }
    if (!Array.isArray(route.criticalStates) || route.criticalStates.length === 0) {
      errors.push(`${prefix} has no critical-state decision.`);
    } else {
      for (const state of route.criticalStates) {
        if (!route.states?.includes(state)) errors.push(`${prefix} critical state "${state}" is absent from its state inventory.`);
      }
    }
  }

  const representedStates = new Set(routes.flatMap((route) => route.states ?? []));
  for (const state of inventory.requiredStateFamilies ?? []) {
    if (!representedStates.has(state)) errors.push(`Required state family is not represented by any route: ${state}.`);
  }

  validateNamedSurfaceFamily({
    dispositions: inventory.panelDispositions,
    errors,
    family: "Panel",
    names: inventory.panels ?? [],
    root,
    sources: inventory.panelSources,
    validDispositions,
  });
  validateNamedSurfaceFamily({
    dispositions: inventory.overlayDispositions,
    errors,
    family: "Overlay",
    names: inventory.overlays ?? [],
    root,
    sources: inventory.overlaySources,
    validDispositions,
  });

  const visualCoverage = inventory.visualCoverage ?? {};
  const baselines = visualCoverage.baselines ?? {};
  if (!sameKeys([...uniqueRoutePaths].sort(), Object.keys(baselines).sort())) {
    errors.push("Visual baseline keys must exactly match the inventoried route paths.");
  }
  for (const key of [...Object.keys(visualCoverage.exemptions ?? {}), ...Object.keys(visualCoverage.gaps ?? {})]) {
    if (!uniqueRoutePaths.includes(key)) errors.push(`Visual coverage decision references unknown route: ${key}.`);
  }
  const normalizedSnapshots = snapshotFiles.map((file) => file.split(path.sep).join("/"));
  for (const route of routes) {
    const snapshots = baselines[route.path];
    const exemption = visualCoverage.exemptions?.[route.path];
    const gap = visualCoverage.gaps?.[route.path];
    if (!Array.isArray(snapshots)) {
      errors.push(`Route "${route.path}" has no visual baseline record.`);
      continue;
    }
    if (snapshots.length === 0 && !exemption && !gap) {
      errors.push(`Route "${route.path}" has neither a stored baseline nor an explicit exemption/gap.`);
    }
    for (const snapshot of snapshots) {
      if (!normalizedSnapshots.some((file) => file.endsWith(`/${snapshot}.png`))) {
        errors.push(`Route "${route.path}" claims missing snapshot "${snapshot}.png".`);
      }
    }
    for (const viewportName of route.responsiveWidths ?? []) {
      const project = viewports[viewportName]?.project;
      if (!project || snapshots.length === 0) continue;
      const hasViewportEvidence = snapshots.some((snapshot) =>
        normalizedSnapshots.some((file) => file.includes(`/darwin/${project}/`) && file.endsWith(`/${snapshot}.png`)),
      );
      if (!hasViewportEvidence) {
        errors.push(`Route "${route.path}" has no ${viewportName} stored baseline evidence.`);
      }
    }
    if (gap) gaps.push(`route:${route.path}: ${gap}`);
  }

  return {
    errors,
    gaps,
    stats: {
      discoveredRoutes: discoveredRoutes.length,
      inventoriedRoutes: routes.length,
      overlays: inventory.overlays?.length ?? 0,
      panels: inventory.panels?.length ?? 0,
      storedSnapshots: snapshotFiles.length,
    },
  };
}

export function loadUiSurfaceInventoryInputs(root = DEFAULT_ROOT) {
  return {
    root,
    inventory: readJson(root, "docs/ui-surface-inventory.json"),
    appRoutesSource: read(root, "frontend/src/routes/AppRoutes.tsx"),
    workspaceRouteSource: read(root, "frontend/src/lib/workspaceRoute.ts"),
    playwrightSource: read(root, "playwright.config.ts"),
    snapshotFiles: listFiles(path.join(root, "e2e/__snapshots__")),
  };
}

export function runUiSurfaceInventoryCheck({ requireComplete = false, root = DEFAULT_ROOT } = {}) {
  const result = validateUiSurfaceInventory(loadUiSurfaceInventoryInputs(root));
  if (result.errors.length > 0) {
    throw new Error(`UI surface inventory invalid:\n- ${result.errors.join("\n- ")}`);
  }
  if (requireComplete && result.gaps.length > 0) {
    throw new Error(`UI surface inventory is structurally valid but incomplete:\n- ${result.gaps.join("\n- ")}`);
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === MODULE_PATH) {
  try {
    const result = runUiSurfaceInventoryCheck({ requireComplete: process.argv.includes("--require-complete") });
    console.log(
      `UI surface inventory: ${result.stats.inventoriedRoutes} routes, `
      + `${result.stats.panels} panels, ${result.stats.overlays} overlays; `
      + `${result.gaps.length} explicit completion gaps.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
