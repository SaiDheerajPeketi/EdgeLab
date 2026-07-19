import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ACTUAL_COMPONENT_SCENES, ActualAppSceneFrame, seedBacktestStoreForCapture } from "./ActualAppScenes.jsx";

export function renderScenes() {
  installServerDomShim();
  return ACTUAL_COMPONENT_SCENES.map((scene) => {
    seedBacktestStoreForCapture();
    return {
      id: scene.id,
      title: scene.title,
      sourceComponents: scene.sourceComponents,
      html: renderToStaticMarkup(<ActualAppSceneFrame scene={scene} />),
    };
  });
}

function installServerDomShim() {
  if (!globalThis.document) {
    globalThis.document = {
      body: { nodeType: 1 },
      fullscreenElement: null,
      addEventListener() {},
      createElement() {
        return {
          _html: "",
          get innerText() {
            return this._html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
          },
          get textContent() {
            return this.innerText;
          },
          set innerHTML(value) {
            this._html = String(value ?? "");
          },
        };
      },
      removeEventListener() {},
    };
  }
  if (!globalThis.window) {
    globalThis.window = {
      addEventListener() {},
      clearTimeout() {},
      document: globalThis.document,
      innerHeight: 2160,
      innerWidth: 3840,
      localStorage: {
        getItem() { return null; },
        removeItem() {},
        setItem() {},
      },
      matchMedia() {
        return { matches: false, addEventListener() {}, removeEventListener() {} };
      },
      requestAnimationFrame(callback) {
        return setTimeout(callback, 0);
      },
      setTimeout,
    };
  }
}
