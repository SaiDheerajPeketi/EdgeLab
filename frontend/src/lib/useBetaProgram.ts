import { useEffect, useState } from "react";
import type { BetaProgramStatus } from "./api";
import { ApiError, getBetaProgramStatus } from "./api";
import { getBetaSeatState } from "./deploymentMode";

function fallbackProgramStatus(): BetaProgramStatus {
  const fallback = getBetaSeatState();
  return {
    mode: "beta",
    seats_total: fallback.total,
    seats_taken: fallback.taken,
    seats_remaining: fallback.remaining,
    waitlist_count: 0,
  };
}

export function useBetaProgramStatus() {
  const [program, setProgram] = useState<BetaProgramStatus>(fallbackProgramStatus);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    getBetaProgramStatus()
      .then((response) => {
        if (!active) {
          return;
        }
        setProgram(response);
        setError(null);
      })
      .catch((responseError: unknown) => {
        if (!active) {
          return;
        }
        setError(responseError instanceof ApiError ? responseError.message : "Beta program unavailable");
        setProgram(fallbackProgramStatus());
      });

    return () => {
      active = false;
    };
  }, []);

  return {
    error,
    program,
  };
}
