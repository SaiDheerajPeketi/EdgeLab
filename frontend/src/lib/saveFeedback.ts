import { assertAppDataAccess, captureAppDataAccess } from "./appDataBarrier";

export function createOwnedSaveFeedback(saved: () => void, failed: (error: unknown) => void) {
  let currentWrite = 0, mounted = true;
  return {
    mount() { mounted = true; },
    invalidate() { currentWrite += 1; },
    dispose() { mounted = false; currentWrite += 1; },
    async run(action: () => unknown | Promise<unknown>, markSaved: boolean | (() => void) = true) {
      const write = ++currentWrite;
      let access: ReturnType<typeof captureAppDataAccess> = null, captured = false, admitted = false;
      const owns = (admissionFailure = false) => {
        if (!mounted || !captured || write !== currentWrite) return false;
        try {
          const current = captureAppDataAccess();
          if (current?.owner !== access?.owner || current?.token !== access?.token || current?.epoch !== access?.epoch) return false;
          if (!admissionFailure) assertAppDataAccess(access);
          return true;
        } catch { return false; }
      };
      try {
        access = captureAppDataAccess(); captured = true;
        assertAppDataAccess(access, true);
        admitted = true;
        await action();
        if (owns()) { if (typeof markSaved === "function") markSaved(); else if (markSaved) saved(); }
      } catch (error) { if (owns(!admitted)) failed(error); }
    },
  };
}
