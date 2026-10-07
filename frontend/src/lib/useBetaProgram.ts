import { useEffect, useState } from "react";
import type { BetaProgramStatus } from "./api";
import { ApiError, getBetaProgramStatus } from "./api";
import { deploymentMode, getBetaSeatState } from "./deploymentMode";

export type BetaProgramView = {
  mode: "beta" | "production";
  seats_total: number;
  seats_taken: number | null;
  seats_remaining: number | null;
  waitlist_count: number | null;
};

function fallbackProgramStatus(): BetaProgramView {
  const fallback = getBetaSeatState();
  return {
    mode: deploymentMode,
    seats_total: fallback.total,
    seats_taken: null,
    seats_remaining: null,
    waitlist_count: null,
  };
}

function liveProgramStatus(program: BetaProgramStatus): BetaProgramView {
  return {
    mode: program.mode,
    seats_total: program.seats_total,
    seats_taken: program.seats_taken,
    seats_remaining: program.seats_remaining,
    waitlist_count: program.waitlist_count,
  };
}

export function useBetaProgramStatus() {
  const [program, setProgram] = useState<BetaProgramView>(fallbackProgramStatus);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    getBetaProgramStatus()
      .then((response) => {
        if (!active) {
          return;
        }
        setProgram(liveProgramStatus(response));
        setError(null);
        setLoading(false);
      })
      .catch((responseError: unknown) => {
        if (!active) {
          return;
        }
        setError(responseError instanceof ApiError ? responseError.message : "Beta program unavailable");
        setProgram(fallbackProgramStatus());
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return {
    error,
    loading,
    program,
  };
}
