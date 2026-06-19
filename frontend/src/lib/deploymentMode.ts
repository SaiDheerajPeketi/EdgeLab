export type DeploymentMode = "beta" | "production";

function parseNumber(rawValue: string | undefined, fallback: number) {
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function resolveDeploymentMode(rawValue: string | undefined): DeploymentMode {
  return rawValue?.trim().toLowerCase() === "production" ? "production" : "beta";
}

export const deploymentMode = resolveDeploymentMode(import.meta.env.VITE_DEPLOYMENT_MODE);

export function isBetaMode(mode: DeploymentMode = deploymentMode) {
  return mode === "beta";
}

export function getBetaSeatState() {
  const total = Math.max(1, parseNumber(import.meta.env.VITE_BETA_SEATS_TOTAL, 500));
  const taken = Math.max(0, parseNumber(import.meta.env.VITE_BETA_SEATS_TAKEN, 127));
  const remaining = Math.max(0, total - taken);
  const fillRatio = Math.min(1, taken / total);

  return {
    fillRatio,
    remaining,
    taken,
    total,
  };
}
