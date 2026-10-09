import { ArrowLeft, ArrowRight, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useMarketingReducedMotionPreference } from "../../lib/marketingMotion";
import { CANDLES, PRICE_SCALE, ENTRY_INDEX, EXIT_INDEX, FLOOR_Y, STOP_PRICE, WORLD_YAW, CAMERA_FOV, candlePosition, priceY } from "../../lib/marketSculptureGeometry";
import { MarketSculptureProjection } from "./MarketSculptureProjection";
import type { BufferGeometry, InstancedMesh, Material, Object3D, WebGLRenderer } from "three";

type Chapter = "price" | "decisions" | "review";
type SceneControl = { chapter(value: Chapter): void; view(yaw: number, pitch: number): void };
const ORBIT_KEYS: Record<string, [number, number]> = { ArrowLeft: [-0.08, 0], ArrowRight: [0.08, 0], ArrowUp: [0, -0.06], ArrowDown: [0, 0.06] };

const CHAPTERS: { id: Chapter; label: string; title: string; detail: string }[] = [
  { id: "price", label: "Price", title: "See the whole market move.", detail: "Follow the swings, pullbacks, and turning points that shape a trading session." },
  { id: "decisions", label: "Decisions", title: "Keep the decision in view.", detail: "See an example entry, stop, and exit beside the price action that shaped them." },
  { id: "review", label: "Review", title: "Return to the reason.", detail: "Review the entry and exit together, then carry your notes into the next session." },
];

export function MarketSculpture({ className = "" }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const controlRef = useRef<SceneControl | null>(null);
  const chapterRef = useRef<Chapter>("price");
  const [chapter, setChapter] = useState<Chapter>("price");
  const [status, setStatus] = useState<"loading" | "ready" | "fallback">("loading");
  const [view, setView] = useState({ yaw: 0, pitch: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [size, setSize] = useState({ width: 600, height: 500 });
  const [projectionScroll, setProjectionScroll] = useState(0);
  const dragRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const reducedMotion = useMarketingReducedMotionPreference();
  const orbit = (x: number, y: number) => setView((current) => ({
    yaw: Math.max(-0.42, Math.min(0.42, current.yaw + x)),
    pitch: Math.max(-0.3, Math.min(0.3, current.pitch + y)),
  }));
  const reset = () => setView({ yaw: 0, pitch: 0 });
  chapterRef.current = chapter;
  const content = CHAPTERS.find((item) => item.id === chapter)!;

  useEffect(() => { controlRef.current?.chapter(chapter); }, [chapter]);
  useEffect(() => { controlRef.current?.view(view.yaw, view.pitch); }, [view]);

  useEffect(() => {
    const mount = canvasRef.current;
    if (!mount) return;
    const resize = () => {
      const width = Math.max(1, mount.clientWidth), height = Math.max(1, mount.clientHeight);
      setSize((current) => current.width === width && current.height === height ? current : { width, height });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();
    return () => observer.disconnect();
  }, []);

  // The projected scene keeps the same scroll perspective without an animation loop.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || status === "ready") return;
    let frame = 0, visible = false;
    const render = () => {
      frame = 0;
      if (!visible || document.hidden) return;
      const rect = host.getBoundingClientRect();
      const next = reducedMotion ? 0 : Math.max(-1, Math.min(1, (window.innerHeight * 0.45 - rect.top) / window.innerHeight));
      setProjectionScroll((current) => current === next ? current : next);
    };
    const request = () => { if (!frame && visible && !document.hidden) frame = requestAnimationFrame(render); };
    const visibility = () => {
      host.dataset.sceneActive = String(visible && !document.hidden);
      if (!visible || document.hidden) { cancelAnimationFrame(frame); frame = 0; } else request();
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting ?? false; visibility(); });
    observer.observe(host);
    document.addEventListener("visibilitychange", visibility);
    if (!reducedMotion) window.addEventListener("scroll", request, { passive: true });
    return () => { cancelAnimationFrame(frame); observer.disconnect(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("scroll", request); };
  }, [reducedMotion, status]);

  useEffect(() => {
    const host = hostRef.current;
    const mount = canvasRef.current;
    if (!host || !mount) return;
    let disposed = false;
    let cleanScene = () => {};
    setStatus("loading");
    // Keep Three out of the public route's initial JS. Import only near the scene.
    const initialize = async () => {
      try {
        const THREE = await import("./marketSceneThree");
        if (disposed) return;
        const geometries = new Set<BufferGeometry>();
        const materials = new Set<Material>();
        const instances = new Set<InstancedMesh>();
        let renderer: WebGLRenderer | null = null;
        let frame = 0;
        let visible = true;
        let { yaw, pitch } = viewRef.current;
        let scroll = 0;
        const scene = new THREE.Scene();
        const world = new THREE.Group();
        scene.add(world);
        const remember = <T extends Object3D>(object: T) => {
          object.traverse((child) => {
            const mesh = child as Object3D & { geometry?: BufferGeometry; material?: Material | Material[] };
            if (mesh.geometry) geometries.add(mesh.geometry);
            if (mesh.material) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((material) => materials.add(material));
            if (child instanceof THREE.InstancedMesh) instances.add(child);
          });
          return object;
        };
        try {
          renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
        } catch { setStatus("fallback"); return; }
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        renderer.setClearColor(0x050a10, 0);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        const canvas = renderer.domElement;
        canvas.setAttribute("aria-hidden", "true");
        canvas.style.display = "block";
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.position = "absolute";
        canvas.style.inset = "0";
        canvas.style.opacity = "0";
        mount.appendChild(canvas);
        const disposeResources = () => {
          window.cancelAnimationFrame(frame);
          controlRef.current = null;
          instances.forEach((instance) => instance.dispose());
          geometries.forEach((geometry) => geometry.dispose());
          materials.forEach((material) => material.dispose());
          renderer?.dispose(); renderer?.forceContextLoss(); renderer = null;
          canvas.remove();
        };
        cleanScene = disposeResources;
        const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100);
        scene.add(new THREE.AmbientLight(0xd6f6ff, 1.2));
        const key = new THREE.DirectionalLight(0xe2fcff, 3);
        key.position.set(-5, 10, 6);
        scene.add(key);
        const rim = new THREE.DirectionalLight(0x32d3ee, 2.2);
        rim.position.set(8, 2, -8);
        scene.add(rim);
        const bodyGeometry = new THREE.BoxGeometry(1, 1, 1);
        const candleMaterial = new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.48 });
        const bodies = remember(new THREE.InstancedMesh(bodyGeometry, candleMaterial, CANDLES.length));
        const wicks = remember(new THREE.InstancedMesh(bodyGeometry, new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.3 }), CANDLES.length));
        const volume = remember(new THREE.InstancedMesh(bodyGeometry, new THREE.MeshBasicMaterial({ color: 0x2c97a8, transparent: true, opacity: 0.42 }), CANDLES.length));
        const dummy = new THREE.Object3D();
        const toY = priceY;
        const position = candlePosition;
        CANDLES.forEach((bar, index) => {
          const { x, z } = position(index);
          const tint = new THREE.Color(bar.close >= bar.open ? "#55e6bb" : "#fa7893");
          dummy.position.set(x, toY((bar.open + bar.close) / 2), z);
          dummy.scale.set(0.115, Math.max(0.075, Math.abs(bar.close - bar.open) * PRICE_SCALE), 0.34);
          dummy.updateMatrix(); bodies.setMatrixAt(index, dummy.matrix); bodies.setColorAt(index, tint);
          dummy.position.set(x, toY((bar.high + bar.low) / 2), z);
          dummy.scale.set(0.023, (bar.high - bar.low) * PRICE_SCALE, 0.04);
          dummy.updateMatrix(); wicks.setMatrixAt(index, dummy.matrix); wicks.setColorAt(index, tint);
          dummy.position.set(x, -4.3 + bar.volume * 0.4, z);
          dummy.scale.set(0.105, bar.volume * 0.8, 0.34);
          dummy.updateMatrix(); volume.setMatrixAt(index, dummy.matrix);
        });
        world.add(bodies, wicks, volume);
        // A measured floor places candles in real perspective, without changing their prices.
        const gridPoints: number[] = [];
        for (let x = -10; x <= 10; x += 2) gridPoints.push(x, FLOOR_Y, -4, x, FLOOR_Y, 4);
        for (let z = -4; z <= 4; z += 1) gridPoints.push(-10, FLOOR_Y, z, 10, FLOOR_Y, z);
        const grid = remember(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(gridPoints, 3)), new THREE.LineBasicMaterial({ color: 0x275464, transparent: true, opacity: 0.45 })));
        world.add(grid);
        const decisions = new THREE.Group();
        const review = new THREE.Group();
        const landmarks = [ENTRY_INDEX, EXIT_INDEX].map((index) => {
          const bar = CANDLES[index];
          const { x, z } = position(index);
          const marker = remember(new THREE.Mesh(new THREE.OctahedronGeometry(0.25), new THREE.MeshStandardMaterial({ color: index === ENTRY_INDEX ? 0x32d3ee : 0xfbbf24, emissive: index === ENTRY_INDEX ? 0x083c46 : 0x4a3004, roughness: 0.25 })));
          marker.position.set(x, toY(bar.high) + 0.9, z);
          const stem = remember(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, FLOOR_Y, z), marker.position]), new THREE.LineBasicMaterial({ color: index === ENTRY_INDEX ? 0x32d3ee : 0xfbbf24, transparent: true, opacity: 0.6 })));
          decisions.add(marker, stem);
          const ring = remember(new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.022, 6, 48), new THREE.MeshBasicMaterial({ color: 0x32d3ee })));
          ring.rotation.x = Math.PI / 2;
          ring.position.set(x, -4.3, z);
          decisions.add(ring);
          return marker.position.clone();
        });
        const trail = remember(new THREE.Line(new THREE.BufferGeometry().setFromPoints([landmarks[0], new THREE.Vector3(landmarks[0].x, landmarks[1].y, landmarks[0].z), landmarks[1]]), new THREE.LineBasicMaterial({ color: 0x32d3ee })));
        review.add(trail);
        const stopStart = position(ENTRY_INDEX), stopEnd = position(EXIT_INDEX);
        const stop = remember(new THREE.Mesh(new THREE.BoxGeometry(stopEnd.x - stopStart.x, 0.035, 0.4), new THREE.MeshBasicMaterial({ color: 0xfb7185, transparent: true, opacity: 0.7 })));
        stop.position.set((stopStart.x + stopEnd.x) / 2, toY(STOP_PRICE), stopStart.z);
        decisions.add(stop);
        world.add(decisions, review);

        const render = () => {
          frame = 0;
          if (disposed || !renderer || !visible || document.hidden) return;
          const rect = host.getBoundingClientRect();
          scroll = reducedMotion ? 0 : Math.max(-1, Math.min(1, (window.innerHeight * 0.45 - rect.top) / window.innerHeight));
          const angle = 0.28 + yaw + scroll * 0.13;
          const distance = Math.max(20, 29 / camera.aspect);
          camera.position.set(Math.sin(angle) * distance, distance * 0.34 + pitch * 6 + scroll * 0.9, Math.cos(angle) * distance);
          camera.lookAt(0, -0.8, 0);
          world.rotation.y = WORLD_YAW;
          try { renderer.render(scene, camera); }
          catch { setStatus("fallback"); cleanScene(); return; }
          canvas.style.opacity = "1";
          setStatus((current) => current === "ready" ? current : "ready");
          host.dataset.renderCount = String(Number(host.dataset.renderCount ?? 0) + 1);
        };
        const requestRender = () => { if (!disposed && visible && !document.hidden && !frame) frame = window.requestAnimationFrame(render); };
        const setChapter = (value: Chapter) => { decisions.visible = value !== "price"; review.visible = value === "review"; requestRender(); };
        controlRef.current = { chapter: setChapter, view(nextYaw, nextPitch) { yaw = nextYaw; pitch = nextPitch; requestRender(); } };
        setChapter(chapterRef.current);
        const resize = () => {
          if (!renderer) return;
          const width = Math.max(1, mount.clientWidth), height = Math.max(1, mount.clientHeight);
          renderer.setSize(width, height, false);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          requestRender();
        };
        const resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(mount);
        const visibilityObserver = new IntersectionObserver(([entry]) => {
          visible = entry?.isIntersecting ?? false;
          host.dataset.sceneActive = String(visible && !document.hidden);
          if (!visible) { window.cancelAnimationFrame(frame); frame = 0; }
          else requestRender();
        });
        visibilityObserver.observe(host);
        const visibility = () => { host.dataset.sceneActive = String(visible && !document.hidden); if (document.hidden) { window.cancelAnimationFrame(frame); frame = 0; } else requestRender(); };
        const contextLost = (event: Event) => { event.preventDefault(); setStatus("fallback"); cleanScene(); };
        canvas.addEventListener("webglcontextlost", contextLost);
        document.addEventListener("visibilitychange", visibility);
        if (!reducedMotion) window.addEventListener("scroll", requestRender, { passive: true });
        resize();
        host.dataset.candleCount = String(CANDLES.length);
        host.dataset.sceneActive = "true";
        cleanScene = () => {
          window.cancelAnimationFrame(frame);
          resizeObserver.disconnect(); visibilityObserver.disconnect();
          canvas.removeEventListener("webglcontextlost", contextLost);
          document.removeEventListener("visibilitychange", visibility);
          window.removeEventListener("scroll", requestRender);
          disposeResources();
        };
      } catch { if (!disposed) setStatus("fallback"); cleanScene(); }
    };
    const loadObserver = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) { loadObserver.disconnect(); void initialize(); } }, { rootMargin: "160px" });
    loadObserver.observe(host);
    return () => { disposed = true; loadObserver.disconnect(); cleanScene(); };
  }, [reducedMotion]);

  return <section className={`min-w-0 ${className}`} ref={hostRef} data-market-sculpture data-scene-status={status} data-chapter={chapter} data-candle-count={CANDLES.length} data-camera={`${view.yaw.toFixed(2)},${view.pitch.toFixed(2)}`} aria-label="Explore a market session in three dimensions">
    <div className="relative mt-1 h-[360px] sm:h-[460px] lg:h-[500px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200" tabIndex={0} role="group" aria-label="Rotate the market scene" aria-describedby="market-sculpture-instructions" onKeyDown={(event) => {
      const delta = ORBIT_KEYS[event.key];
      if (delta) { event.preventDefault(); orbit(delta[0], delta[1]); }
      if (event.key === "Home") { event.preventDefault(); reset(); }
    }} onPointerDown={(event) => {
      if (event.pointerType === "touch" || event.button !== 0) return;
      dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerMove={(event) => {
      const drag = dragRef.current;
      if (!drag || drag.id !== event.pointerId) return;
      orbit((event.clientX - drag.x) * 0.004, (event.clientY - drag.y) * 0.003);
      dragRef.current = { id: drag.id, x: event.clientX, y: event.clientY };
    }} onPointerUp={(event) => {
      if (dragRef.current?.id !== event.pointerId) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      dragRef.current = null;
    }} onPointerCancel={() => { dragRef.current = null; }} onLostPointerCapture={() => { dragRef.current = null; }}>
      <div className="absolute inset-0 cursor-grab active:cursor-grabbing" ref={canvasRef}>
        {status !== "ready" ? <MarketSculptureProjection chapter={chapter} yaw={view.yaw + (reducedMotion ? 0 : projectionScroll) * 0.13} pitch={view.pitch + (reducedMotion ? 0 : projectionScroll) * 0.15} width={size.width} height={size.height} /> : null}
      </div>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 border-y border-white/10">
      <div className="flex min-w-0" role="group" aria-label="Market scene chapters">{CHAPTERS.map((item) => <button className={`relative min-h-11 px-3 text-sm transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-200 ${item.id === chapter ? "text-cyan-100" : "text-slate-400"}`} aria-pressed={item.id === chapter} key={item.id} onClick={() => setChapter(item.id)} type="button">{item.label}{item.id === chapter ? <span className="absolute inset-x-3 bottom-0 h-px bg-cyan-200" aria-hidden="true" /> : null}</button>)}</div>
      <div className="flex"><button className="flex h-11 w-11 items-center justify-center text-slate-300 hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200" type="button" aria-label="Rotate scene left" onClick={() => orbit(-0.08, 0)}><ArrowLeft size={15} /></button><button className="flex h-11 w-11 items-center justify-center text-slate-300 hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200" type="button" aria-label="Reset scene view" onClick={reset}><RotateCcw size={15} /></button><button className="flex h-11 w-11 items-center justify-center text-slate-300 hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200" type="button" aria-label="Rotate scene right" onClick={() => orbit(0.08, 0)}><ArrowRight size={15} /></button></div>
    </div>
    <div className="pt-4" aria-live="polite"><h2 className="text-xl font-medium tracking-tight text-white">{content.title}</h2><p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">{content.detail}</p></div>
    <p className="sr-only" id="market-sculpture-instructions">Illustrative market data. Drag with a mouse or use the rotation controls. Arrow keys rotate; Home resets.</p>
  </section>;
}
