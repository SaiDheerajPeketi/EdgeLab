type PriceScaleSettleOptions = {
  cancelFrame: (frameId: number) => void;
  requestFrame: (callback: FrameRequestCallback) => number;
  settleFrames?: number;
  synchronize: () => void;
};

export type PriceScaleSettleScheduler = {
  cancel: () => void;
  schedule: () => void;
};

export function createPriceScaleSettleScheduler({
  cancelFrame,
  requestFrame,
  settleFrames = 3,
  synchronize,
}: PriceScaleSettleOptions): PriceScaleSettleScheduler {
  const frameCount = Math.max(1, Math.trunc(settleFrames));
  let frameId: number | null = null;
  let remainingFrames = 0;

  const run = () => {
    frameId = null;
    synchronize();
    remainingFrames -= 1;
    if (remainingFrames > 0) {
      frameId = requestFrame(run);
    }
  };

  return {
    cancel() {
      remainingFrames = 0;
      if (frameId != null) {
        cancelFrame(frameId);
        frameId = null;
      }
    },
    schedule() {
      remainingFrames = frameCount;
      if (frameId == null) {
        frameId = requestFrame(run);
      }
    },
  };
}
