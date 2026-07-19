import React, { useMemo, useState } from "react";
import { SCENE_HEIGHT, SCENE_WIDTH, buildScenes, renderSceneSvg } from "./scene-data.mjs";

const scenes = buildScenes();

export function PreviewApp() {
  const [sceneId, setSceneId] = useState(scenes[0].id);
  const scene = scenes.find((item) => item.id === sceneId) ?? scenes[0];
  const svg = useMemo(() => renderSceneSvg(scene), [scene]);

  return (
    <main style={styles.page}>
      <aside style={styles.sidebar}>
        <div style={styles.kicker}>EdgeLab</div>
        <h1 style={styles.title}>AE Teaser Assets</h1>
        <p style={styles.copy}>{SCENE_WIDTH} x {SCENE_HEIGHT} vector scenes</p>
        <div style={styles.nav}>
          {scenes.map((item) => (
            <button
              key={item.id}
              onClick={() => setSceneId(item.id)}
              style={{
                ...styles.button,
                ...(item.id === sceneId ? styles.buttonActive : null),
              }}
              type="button"
            >
              {item.title}
            </button>
          ))}
        </div>
      </aside>
      <section style={styles.stage}>
        <div style={styles.frame} dangerouslySetInnerHTML={{ __html: svg }} />
      </section>
    </main>
  );
}

const styles = {
  page: {
    background: "#05070a",
    color: "#e5eef8",
    display: "grid",
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
    gridTemplateColumns: "320px minmax(0, 1fr)",
    margin: 0,
    minHeight: "100vh",
  },
  sidebar: {
    borderRight: "1px solid rgba(148, 163, 184, 0.18)",
    padding: 24,
  },
  kicker: {
    color: "#67e8f9",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.22em",
    textTransform: "uppercase",
  },
  title: {
    fontSize: 28,
    lineHeight: 1,
    margin: "14px 0 8px",
  },
  copy: {
    color: "#8b9bb0",
    fontSize: 13,
    margin: 0,
  },
  nav: {
    display: "grid",
    gap: 8,
    marginTop: 28,
  },
  button: {
    background: "#071018",
    border: "1px solid rgba(148, 163, 184, 0.18)",
    borderRadius: 8,
    color: "#b8c7d9",
    cursor: "pointer",
    font: "inherit",
    padding: "12px 14px",
    textAlign: "left",
  },
  buttonActive: {
    background: "#0e2631",
    borderColor: "rgba(103, 232, 249, 0.45)",
    color: "#ffffff",
  },
  stage: {
    alignItems: "center",
    display: "grid",
    overflow: "auto",
    padding: 32,
  },
  frame: {
    aspectRatio: "16 / 9",
    boxShadow: "0 24px 90px rgba(0, 0, 0, 0.45)",
    maxWidth: "100%",
  },
};
