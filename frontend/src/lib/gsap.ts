type GsapContext = {
  revert(): void;
};

type GsapAnimation = {
  kill(): void;
};

type GsapTimeline = GsapAnimation & {
  add(callback: () => void): GsapTimeline;
  fromTo(
    targets: unknown,
    fromVars: Record<string, unknown>,
    toVars: Record<string, unknown>,
  ): GsapTimeline;
  to(targets: unknown, vars: Record<string, unknown>): GsapTimeline;
};

type GsapQuickTo = (value: number) => void;

export type GsapInstance = {
  core?: {
    globals?(): Record<string, unknown>;
  };
  context(callback: () => void, scope?: Element | null): GsapContext;
  fromTo(
    targets: unknown,
    fromVars: Record<string, unknown>,
    toVars: Record<string, unknown>,
  ): GsapAnimation;
  killTweensOf(targets: unknown): void;
  quickTo(target: unknown, property: string, vars: Record<string, unknown>): GsapQuickTo;
  registerPlugin(...plugins: unknown[]): void;
  set(targets: unknown, vars: Record<string, unknown>): void;
  timeline(vars?: Record<string, unknown>): GsapTimeline;
  to(targets: unknown, vars: Record<string, unknown>): GsapAnimation;
};

type GsapPluginName =
  | "CustomEase"
  | "Draggable"
  | "Flip"
  | "InertiaPlugin"
  | "Observer"
  | "ScrollToPlugin"
  | "ScrollTrigger"
  | "SplitText";

type GsapPluginValue = Record<string, unknown>;

type ScrollTriggerInstance = {
  kill(): void;
};

type SplitTextInstance = {
  chars?: Element[];
  lines?: Element[];
  revert(): void;
  words?: Element[];
};

export type GsapPlugins = {
  CustomEase?: {
    create(name: string, definition: string): unknown;
  };
  Draggable?: GsapPluginValue;
  Flip?: {
    from(state: unknown, vars: Record<string, unknown>): GsapAnimation;
    getState(targets: unknown): unknown;
  };
  InertiaPlugin?: GsapPluginValue;
  Observer?: {
    create(vars: Record<string, unknown>): GsapAnimation;
  };
  ScrollToPlugin?: GsapPluginValue;
  ScrollTrigger?: {
    create(vars: Record<string, unknown>): ScrollTriggerInstance;
    refresh(): void;
  };
  SplitText?: {
    create(targets: unknown, vars: Record<string, unknown>): SplitTextInstance;
  };
};

export type GsapRuntime = {
  gsap: GsapInstance;
  plugins: GsapPlugins;
};

type LoadGsapOptions = {
  plugins?: GsapPluginName[];
};

declare global {
  interface Window {
    CustomEase?: GsapPlugins["CustomEase"];
    Draggable?: GsapPlugins["Draggable"];
    Flip?: GsapPlugins["Flip"];
    InertiaPlugin?: GsapPlugins["InertiaPlugin"];
    Observer?: GsapPlugins["Observer"];
    ScrollToPlugin?: GsapPlugins["ScrollToPlugin"];
    ScrollTrigger?: GsapPlugins["ScrollTrigger"];
    SplitText?: GsapPlugins["SplitText"];
    __edgelabGsapPromise__?: Promise<GsapInstance>;
    gsap?: GsapInstance;
  }
}

const CORE_SCRIPT_SRC = "/vendor/gsap/gsap.min.js";
const PLUGIN_SCRIPT_SOURCES: Record<GsapPluginName, string> = {
  CustomEase: "/vendor/gsap/CustomEase.min.js",
  Draggable: "/vendor/gsap/Draggable.min.js",
  Flip: "/vendor/gsap/Flip.min.js",
  InertiaPlugin: "/vendor/gsap/InertiaPlugin.min.js",
  Observer: "/vendor/gsap/Observer.min.js",
  ScrollToPlugin: "/vendor/gsap/ScrollToPlugin.min.js",
  ScrollTrigger: "/vendor/gsap/ScrollTrigger.min.js",
  SplitText: "/vendor/gsap/SplitText.min.js",
};

const pluginScriptPromises = new Map<string, Promise<void>>();
const registeredPlugins = new Set<GsapPluginName>();

function loadScriptOnce(src: string) {
  const existingPromise = pluginScriptPromises.get(src);
  if (existingPromise) {
    return existingPromise;
  }

  const promise = new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    const handleLoad = () => resolve();
    const handleError = () => reject(new Error(`Failed to load GSAP script: ${src}`));

    if (existingScript) {
      if (existingScript.dataset.loaded === "true") {
        resolve();
        return;
      }
      existingScript.addEventListener("load", handleLoad, { once: true });
      existingScript.addEventListener("error", handleError, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.src = src;
    script.addEventListener(
      "load",
      () => {
        script.dataset.loaded = "true";
        resolve();
      },
      { once: true },
    );
    script.addEventListener("error", handleError, { once: true });
    document.head.appendChild(script);
  });

  pluginScriptPromises.set(src, promise);
  return promise;
}

function resolvePlugin<K extends GsapPluginName>(pluginName: K): GsapPlugins[K] | undefined {
  const coreGlobals = window.gsap?.core?.globals?.() ?? {};
  return (window[pluginName] ?? coreGlobals[pluginName]) as GsapPlugins[K] | undefined;
}

function registerPluginIfAvailable(gsap: GsapInstance, pluginName: GsapPluginName) {
  if (registeredPlugins.has(pluginName)) {
    return;
  }

  const plugin = resolvePlugin(pluginName);
  if (!plugin) {
    return;
  }

  gsap.registerPlugin(plugin);
  registeredPlugins.add(pluginName);
}

export { prefersReducedMotion };

export async function loadGsap(options: LoadGsapOptions = {}): Promise<GsapRuntime> {
  if (typeof window === "undefined") {
    throw new Error("GSAP can only load in the browser.");
  }

  if (!window.__edgelabGsapPromise__) {
    window.__edgelabGsapPromise__ = loadScriptOnce(CORE_SCRIPT_SRC).then(() => {
      if (!window.gsap) {
        throw new Error("GSAP loaded but window.gsap was not found.");
      }
      return window.gsap;
    });
  }

  const gsap = await window.__edgelabGsapPromise__;
  const requestedPlugins = options.plugins ?? [];

  if (requestedPlugins.length > 0) {
    await Promise.all(
      requestedPlugins.map((pluginName) => loadScriptOnce(PLUGIN_SCRIPT_SOURCES[pluginName])),
    );
    requestedPlugins.forEach((pluginName) => registerPluginIfAvailable(gsap, pluginName));
  }

  return {
    gsap,
    plugins: {
      CustomEase: resolvePlugin("CustomEase"),
      Draggable: resolvePlugin("Draggable"),
      Flip: resolvePlugin("Flip"),
      InertiaPlugin: resolvePlugin("InertiaPlugin"),
      Observer: resolvePlugin("Observer"),
      ScrollToPlugin: resolvePlugin("ScrollToPlugin"),
      ScrollTrigger: resolvePlugin("ScrollTrigger"),
      SplitText: resolvePlugin("SplitText"),
    },
  };
}
import { prefersReducedMotion } from "./motionPreferences";
