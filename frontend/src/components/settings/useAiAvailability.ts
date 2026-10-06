import { useEffect, useState, useSyncExternalStore } from "react";
import { apiRequest } from "../../lib/api";
import { getStoredAuthSession, subscribeAuthSession } from "../../lib/authSession";

export type SettingsAiModel = { model_id: string; display_name: string; provider: string; operations: string[]; available: boolean; adapter_configured: boolean; credential_required: boolean; availability_reason: string };
function modelsFrom(value: unknown): SettingsAiModel[] {
  if (!Array.isArray(value) || value.some((model) => !model || typeof model !== "object" ||
    ["model_id", "display_name", "provider", "availability_reason"].some((key) => typeof model[key] !== "string") ||
    ["available", "adapter_configured", "credential_required"].some((key) => typeof model[key] !== "boolean") ||
    !Array.isArray(model.operations) || model.operations.some((operation: unknown) => typeof operation !== "string")) ||
    new Set(value.map((model) => model.model_id)).size !== value.length) throw new Error("Model availability could not be verified.");
  return value;
}

export function useAiAvailability() {
  const session = useSyncExternalStore(subscribeAuthSession, getStoredAuthSession, () => null);
  const token = session?.token ?? "";
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ token: string; models: SettingsAiModel[] | null; error: boolean }>({ token: "", models: null, error: false });
  useEffect(() => {
    let cancelled = false;
    setResult({ token, models: null, error: false });
    if (!token) return;
    void apiRequest<unknown>("/quant/models").then(modelsFrom).then((models) => {
      if (!cancelled && getStoredAuthSession()?.token === token) setResult({ token, models, error: false });
    }).catch(() => {
      if (!cancelled && getStoredAuthSession()?.token === token) setResult({ token, models: null, error: true });
    });
    return () => { cancelled = true; };
  }, [token, revision]);
  const current = result.token === token ? result : { models: null, error: false };
  return { ...current, loading: current.models === null && !current.error, reload: () => setRevision((value) => value + 1) };
}
