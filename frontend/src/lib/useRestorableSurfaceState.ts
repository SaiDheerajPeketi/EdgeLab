import { useEffect, useRef, useState } from "react";
import {
  navigationStateFor,
  updateNavigationState,
  type NavigationSurfaceId,
  type NavigationSurfaceState,
} from "./navigationState";

type RestorableKey = "draft" | "filters" | "openPanel" | "selectedId" | "viewport";

/** Keeps task state through route changes without exposing private drafts in URLs. */
export function useRestorableSurfaceState<T>(
  surface: NavigationSurfaceId,
  key: RestorableKey,
  initialValue: T,
) {
  const initialRef = useRef(initialValue);
  const [value, setValue] = useState<T>(() => {
    const saved = navigationStateFor(surface)?.[key];
    return (saved === undefined ? initialRef.current : saved) as T;
  });

  useEffect(() => {
    const saved = navigationStateFor(surface)?.[key];
    if (saved !== undefined) setValue(saved as T);
  }, [key, surface]);

  useEffect(() => {
    updateNavigationState(surface, { [key]: value } as Partial<NavigationSurfaceState>);
  }, [key, surface, value]);

  return [value, setValue] as const;
}
