import { Composition } from "remotion";
import { EdgeLabBetaLaunch } from "./scenes/EdgeLabBetaLaunch";

export const Root = () => {
  return (
    <>
      <Composition
        id="EdgeLabBetaLaunch"
        component={EdgeLabBetaLaunch}
        durationInFrames={2160}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="EdgeLabBetaLaunchPortrait"
        component={EdgeLabBetaLaunch}
        durationInFrames={2160}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{ portrait: true }}
      />
    </>
  );
};
