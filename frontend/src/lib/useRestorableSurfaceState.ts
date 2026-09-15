import { useEffect, useRef, useState } from "react";
import {
  navigationStateFor,
  updateNavigationState,
  type NavigationSurfaceId,
  type NavigationSurfaceState,
} from "./navigationState";

type RestorableKey = "draft" | "filters" | "openPanel" | "selectedId" | "viewport";
export type RestorableStateSchema<T> = { version: number; validate: (value: unknown) => value is T };
type RestorableEnvelope = { __schemaVersion: number; value: unknown };

export function restoreSurfaceValue<T>(stored: unknown, initialValue: T, schema: RestorableStateSchema<T>) {
  if (!stored || typeof stored !== "object") return initialValue;
  const envelope = stored as Partial<RestorableEnvelope>;
  return envelope.__schemaVersion === schema.version && schema.validate(envelope.value) ? envelope.value : initialValue;
}

/** Keeps task state through route changes without exposing private drafts in URLs. */
export function useRestorableSurfaceState<T>(
  surface: NavigationSurfaceId,
  key: RestorableKey,
  initialValue: T,
  schema: RestorableStateSchema<T>,
) {
  const initialRef = useRef(initialValue);
  const [value, setValue] = useState<T>(() => {
    const saved = navigationStateFor(surface)?.[key];
    return restoreSurfaceValue(saved, initialRef.current, schema);
  });

  useEffect(() => {
    const saved = navigationStateFor(surface)?.[key];
    setValue(restoreSurfaceValue(saved, initialRef.current, schema));
  }, [key, schema, surface]);

  useEffect(() => {
    updateNavigationState(surface, { [key]: { __schemaVersion: schema.version, value } } as Partial<NavigationSurfaceState>);
  }, [key, schema.version, surface, value]);

  return [value, setValue] as const;
}
