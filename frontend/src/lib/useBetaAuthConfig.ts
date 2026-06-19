import { useEffect, useState } from "react";
import type { BetaAuthConfig } from "./api";
import { ApiError, getBetaAuthConfig } from "./api";

const FALLBACK_AUTH_CONFIG: BetaAuthConfig = {
  google_enabled: false,
  google_client_id: null,
  google_redirect_uri: null,
  manual_access_enabled: false,
};

export function useBetaAuthConfig() {
  const [config, setConfig] = useState<BetaAuthConfig>(FALLBACK_AUTH_CONFIG);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    getBetaAuthConfig()
      .then((response) => {
        if (!active) {
          return;
        }
        setConfig(response);
        setError(null);
        setLoading(false);
      })
      .catch((responseError: unknown) => {
        if (!active) {
          return;
        }
        setConfig(FALLBACK_AUTH_CONFIG);
        setError(responseError instanceof ApiError ? responseError.message : "Beta auth unavailable");
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return {
    config,
    error,
    loading,
  };
}
