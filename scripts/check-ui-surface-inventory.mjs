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

function unique(values) {
  return [...new Set(values)];
}

function sameKeys(left, right) {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

function readPngDimensions(filePath) {
  const file = fs.readFileSync(filePath);
  const isPng = file.length >= 24
    && file[0] === 0x89
    && file.subarray(1, 4).toString("ascii") === "PNG";
  if (!isPng) return null;
  return { height: file.readUInt32BE(20), width: file.readUInt32BE(16) };
}

export function discoverRouteDefinitions(appRoutesSource, workspaceRouteSource) {
  const appRoutes = [...appRoutesSource.matchAll(/^\s*<Route\b.*\bpath="([^"]+)"/gm)]
    .map((match) => match[1]);
  const workspaceRoutes = [...workspaceRouteSource.matchAll(/\{\s*path:\s*"(\/app[^"]*)"/g)]
    .map((match) => match[1]);
  return unique([...appRoutes, ...workspaceRoutes]).sort();
}

export function discoverPlaywrightProjects(playwrightSource) {
  const projects = new Map();
  for (const match of playwrightSource.matchAll(/name:\s*"([^"]+)"[\s\S]{0,600}?viewport:\s*\{\s*height:\s*(\d+),\s*width:\s*(\d+)/g)) {
    projects.set(match[1], {
      height: Number(match[2]),
      pointer: /hasTouch:\s*true/.test(match[0]) ? "coarse" : "fine",
      width: Number(match[3]),
      zoom: 1,
    });
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
  foundationContracts,
  releaseMatrix,
  visualEvidence,
  appRoutesSource,
  workspaceRouteSource,
  playwrightSource,
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
  const sortedDiscoveredRoutes = [...discoveredRoutes].sort();
  const sortedInventoryRoutes = [...uniqueRoutePaths].sort();
  if (!sameKeys(sortedDiscoveredRoutes, sortedInventoryRoutes)) {
    for (const route of sortedDiscoveredRoutes.filter((route) => !uniqueRoutePaths.includes(route))) {
      errors.push(`Route definition is missing from the surface inventory: ${route}.`);
    }
    for (const route of sortedInventoryRoutes.filter((route) => !discoveredRoutes.includes(route))) {
      errors.push(`Inventory route has no authoritative route definition: ${route}.`);
    }
  }

  const contractRoutePaths = Object.keys(foundationContracts.routes ?? {}).sort();
  if (!sameKeys(sortedInventoryRoutes, contractRoutePaths)) {
    errors.push("Foundation route keys must exactly match the inventoried route paths.");
  }
  for (const [route, contract] of Object.entries(foundationContracts.routes ?? {})) {
    if (!contract?.source || !fs.existsSync(path.join(root, contract.source))) {
      errors.push(`Foundation route "${route}" has a missing source: ${contract?.source ?? "(none)"}.`);
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
      else {
        for (const field of ["width", "height", "pointer", "zoom"]) {
          if (project[field] !== baseline[field]) {
            errors.push(`Viewport "${name}" declares ${field}=${baseline[field]} but Playwright "${baseline.project}" uses ${project[field]}.`);
          }
        }
      }
    } else if (baseline.status !== "gap" || !baseline.reason) {
      errors.push(`Viewport "${name}" without a Playwright project must record a gap reason.`);
    }
    if (baseline.status === "gap") gaps.push(`viewport:${name}: ${baseline.reason}`);
    const matrixViewport = releaseMatrix.viewports?.[name];
    if (!matrixViewport) errors.push(`Viewport "${name}" is absent from the release matrix.`);
    else {
      for (const field of ["width", "height", "pointer", "zoom"]) {
        if (matrixViewport[field] !== baseline[field]) {
          errors.push(`Viewport "${name}" disagrees with the release matrix for ${field}.`);
        }
      }
    }
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
    for (const [state, applicableViewports] of Object.entries(route.stateViewports ?? {})) {
      if (!route.states?.includes(state)) errors.push(`${prefix} viewport applicability references undeclared state "${state}".`);
      if (!Array.isArray(applicableViewports) || applicableViewports.length === 0) {
        errors.push(`${prefix} state "${state}" has no applicable viewports.`);
        continue;
      }
      for (const viewport of applicableViewports) {
        if (!route.responsiveWidths?.includes(viewport)) {
          errors.push(`${prefix} state "${state}" references inapplicable viewport "${viewport}".`);
        }
      }
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
    sources: foundationContracts.panels,
    validDispositions,
  });
  validateNamedSurfaceFamily({
    dispositions: inventory.overlayDispositions,
    errors,
    family: "Overlay",
    names: inventory.overlays ?? [],
    root,
    sources: foundationContracts.overlays,
    validDispositions,
  });

  const visualCoverage = inventory.visualCoverage ?? {};
  const evidenceRoutes = visualEvidence.routes ?? {};
  const defaultCaptureMode = visualEvidence.defaultCaptureMode;
  if (!['viewport', 'full-page'].includes(defaultCaptureMode)) {
    errors.push('Visual evidence must declare defaultCaptureMode as "viewport" or "full-page".');
  }
  for (const key of [...Object.keys(visualCoverage.exemptions ?? {}), ...Object.keys(visualCoverage.gaps ?? {})]) {
    if (!uniqueRoutePaths.includes(key)) errors.push(`Visual coverage decision references unknown route: ${key}.`);
  }
  for (const key of Object.keys(evidenceRoutes)) {
    if (!uniqueRoutePaths.includes(key)) errors.push(`Visual evidence references unknown route: ${key}.`);
  }
  let storedSnapshots = 0;
  for (const route of routes) {
    const stateEvidence = evidenceRoutes[route.path] ?? {};
    const exemption = visualCoverage.exemptions?.[route.path];
    const gap = visualCoverage.gaps?.[route.path];
    if (Object.keys(stateEvidence).length === 0 && !exemption && !gap) {
      errors.push(`Route "${route.path}" has neither a stored baseline nor an explicit exemption/gap.`);
    }
    for (const [state, projectEvidence] of Object.entries(stateEvidence)) {
      if (!route.states?.includes(state)) {
        errors.push(`Route "${route.path}" evidence uses undeclared state "${state}".`);
      }
      const applicableViewports = route.stateViewports?.[state] ?? route.responsiveWidths ?? [];
      const applicableProjects = applicableViewports
        .map((viewportName) => viewports[viewportName]?.project)
        .filter(Boolean);
      for (const viewportName of applicableViewports) {
        const project = viewports[viewportName]?.project;
        if (project && !projectEvidence?.[project]) {
          errors.push(`Route "${route.path}" state "${state}" has no ${viewportName} project evidence.`);
        }
      }
      for (const [project, evidence] of Object.entries(projectEvidence ?? {})) {
        storedSnapshots += 1;
        if (!viewports[project]?.project || viewports[project].project !== project) {
          errors.push(`Route "${route.path}" state "${state}" references unknown project "${project}".`);
          continue;
        }
        if (!applicableProjects.includes(project)) {
          errors.push(`Route "${route.path}" state "${state}" uses project "${project}" outside its applicable viewport contract.`);
        }
        const specPath = path.join(root, evidence.spec ?? "");
        if (!evidence.spec || !fs.existsSync(specPath)) {
          errors.push(`Route "${route.path}" state "${state}" references missing spec "${evidence.spec ?? "(none)"}".`);
          continue;
        }
        const expectedSnapshot = path.join(
          root,
          "e2e/__snapshots__",
          path.basename(evidence.spec),
          visualEvidence.platform,
          project,
          evidence.snapshot ?? "",
        );
        const snapshotExists = Boolean(evidence.snapshot && fs.existsSync(expectedSnapshot));
        if (!snapshotExists) {
          errors.push(`Route "${route.path}" state "${state}" is missing exact ${project} snapshot "${evidence.snapshot ?? "(none)"}".`);
        }
        const captureMode = evidence.captureMode ?? defaultCaptureMode;
        if (!["viewport", "full-page", "element"].includes(captureMode)) {
          errors.push(`Route "${route.path}" state "${state}" uses unsupported capture mode "${evidence.captureMode}".`);
        } else if (snapshotExists && captureMode !== "element") {
          const dimensions = readPngDimensions(expectedSnapshot);
          const expectedWidth = viewports[project].width;
          const expectedHeight = viewports[project].height;
          if (!dimensions) {
            errors.push(`Route "${route.path}" state "${state}" snapshot is not a readable PNG.`);
          } else {
            const dimensionsMatch = captureMode === "viewport"
              ? dimensions.width === expectedWidth && dimensions.height === expectedHeight
              : dimensions.width === expectedWidth && dimensions.height >= expectedHeight;
            if (!dimensionsMatch) {
              errors.push(
                `Route "${route.path}" state "${state}" ${project} ${captureMode} capture is ${dimensions.width}x${dimensions.height}; expected ${captureMode === "viewport" ? `${expectedWidth}x${expectedHeight}` : `${expectedWidth}x${expectedHeight} or taller`}.`,
              );
            }
          }
        }
        const snapshotStem = path.basename(evidence.snapshot ?? "", ".png");
        const specSource = fs.readFileSync(specPath, "utf8");
        const dynamicPrefix = snapshotStem.includes("-")
          ? `${snapshotStem.slice(0, snapshotStem.lastIndexOf("-"))}-\${`
          : "";
        if (snapshotStem && !specSource.includes(snapshotStem) && (!dynamicPrefix || !specSource.includes(dynamicPrefix))) {
          errors.push(`Route "${route.path}" state "${state}" snapshot is not referenced by ${evidence.spec}.`);
        }
      }
    }
    const missingCriticalEvidence = (route.criticalStates ?? []).filter((state) => !stateEvidence[state]);
    if (missingCriticalEvidence.length > 0 && !gap && !exemption) {
      errors.push(`Route "${route.path}" lacks evidence or a gap for critical states: ${missingCriticalEvidence.join(", ")}.`);
    }
    if (gap) gaps.push(`route:${route.path}: ${gap}`);
  }

  const assertionEvidence = visualEvidence.assertions ?? {};
  const assertionGaps = visualEvidence.assertionGaps ?? {};
  for (const assertion of releaseMatrix.requiredAssertions ?? []) {
    const evidence = assertionEvidence[assertion];
    if (!evidence && !assertionGaps[assertion]) {
      errors.push(`Required assertion "${assertion}" has no executable evidence or explicit gap.`);
      continue;
    }
    if (evidence) {
      const sourcePath = path.join(root, evidence.source ?? "");
      if (!evidence.source || !fs.existsSync(sourcePath)) {
        errors.push(`Assertion "${assertion}" references missing source "${evidence.source ?? "(none)"}".`);
      } else {
        const source = fs.readFileSync(sourcePath, "utf8");
        for (const pattern of evidence.patterns ?? []) {
          if (!source.includes(pattern)) errors.push(`Assertion "${assertion}" evidence pattern is missing: ${pattern}.`);
        }
      }
      if (evidence.project && !projects.has(evidence.project)) {
        errors.push(`Assertion "${assertion}" references unknown Playwright project "${evidence.project}".`);
      }
    }
    if (assertionGaps[assertion]) gaps.push(`assertion:${assertion}: ${assertionGaps[assertion]}`);
  }
  for (const assertion of [...Object.keys(assertionEvidence), ...Object.keys(assertionGaps)]) {
    if (!releaseMatrix.requiredAssertions?.includes(assertion)) {
      errors.push(`Assertion evidence references an assertion absent from the release matrix: ${assertion}.`);
    }
  }

  return {
    errors,
    gaps,
    stats: {
      discoveredRoutes: discoveredRoutes.length,
      inventoriedRoutes: routes.length,
      overlays: inventory.overlays?.length ?? 0,
      panels: inventory.panels?.length ?? 0,
      storedSnapshots,
    },
  };
}

export function loadUiSurfaceInventoryInputs(root = DEFAULT_ROOT) {
  return {
    root,
    inventory: readJson(root, "docs/ui-surface-inventory.json"),
    foundationContracts: readJson(root, "docs/ui-foundation-contracts.json"),
    releaseMatrix: readJson(root, "docs/ui-release-matrix.json"),
    visualEvidence: readJson(root, "docs/ui-surface-evidence.json"),
    appRoutesSource: read(root, "frontend/src/routes/AppRoutes.tsx"),
    workspaceRouteSource: read(root, "frontend/src/lib/workspaceRoute.ts"),
    playwrightSource: read(root, "playwright.config.ts"),
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
