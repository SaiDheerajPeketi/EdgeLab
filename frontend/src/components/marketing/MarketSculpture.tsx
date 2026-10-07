import { ArrowLeft, ArrowRight, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useReducedMotionPreference } from "../../lib/motionPreferences";
import type { BufferGeometry, InstancedMesh, Material, Object3D, WebGLRenderer } from "three";

type Chapter = "price" | "decisions" | "review";
type SceneControl = { chapter(value: Chapter): void; orbit(x: number, y: number): void; reset(): void };
const ORBIT_KEYS: Record<string, [number, number]> = { ArrowLeft: [-0.08, 0], ArrowRight: [0.08, 0], ArrowUp: [0, -0.06], ArrowDown: [0, 0.06] };

// A fixed, synthetic session: selecting a chapter never changes the underlying prices.
const CANDLES = Array.from({ length: 96 }, (_, index) => {
  const price = (i: number) => 4210 + i * 0.38 + Math.sin(i * 0.12) * 8 + Math.sin(i * 1.87) * 2.3;
  const open = price(Math.max(0, index - 1));
  const close = price(index);
  return { open, close, high: Math.max(open, close) + 1.2 + Math.abs(Math.sin(index * 0.71)) * 2.2, low: Math.min(open, close) - 1.1 - Math.abs(Math.cos(index * 0.93)) * 2, volume: 0.2 + Math.abs(Math.sin(index * 0.4)) * 0.8 };
});
const CHAPTERS: { id: Chapter; label: string; title: string; detail: string }[] = [
  { id: "price", label: "Price", title: "96 moments. One market context.", detail: "A fixed example session, from first candle to last. Up and down bodies preserve the same OHLC path in every view." },
  { id: "decisions", label: "Decisions", title: "Attach the reason to the moment.", detail: "Example: mark the pullback at candle 44, define a stop, then record the exit at candle 82. The price path stays unchanged." },
  { id: "review", label: "Review", title: "Return to the decision with evidence.", detail: "Example review: entry 44 → exit 82. Note: waited for the pullback. Next session: test the same entry rule again." },
];

export function MarketSculpture({ className = "" }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const controlRef = useRef<SceneControl | null>(null);
  const chapterRef = useRef<Chapter>("price");
  const [chapter, setChapter] = useState<Chapter>("price");
  const [status, setStatus] = useState<"loading" | "ready" | "fallback">("loading");
  const reducedMotion = useReducedMotionPreference();
  chapterRef.current = chapter;
  const content = CHAPTERS.find((item) => item.id === chapter)!;

  useEffect(() => { controlRef.current?.chapter(chapter); }, [chapter]);

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
        let dragging: { id: number; x: number; y: number } | null = null;
        let yaw = 0, pitch = 0, scroll = 0;
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
        const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
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
        const toY = (price: number) => (price - 4228) * 0.13;
        const position = (index: number) => ({ x: (index - 47.5) * 0.18, z: Math.sin(index * 0.055) * 1.75 });
        CANDLES.forEach((bar, index) => {
          const { x, z } = position(index);
          const tint = new THREE.Color(bar.close >= bar.open ? "#55e6bb" : "#fa7893");
          dummy.position.set(x, toY((bar.open + bar.close) / 2), z);
          dummy.scale.set(0.115, Math.max(0.075, Math.abs(bar.close - bar.open) * 0.13), 0.34);
          dummy.updateMatrix(); bodies.setMatrixAt(index, dummy.matrix); bodies.setColorAt(index, tint);
          dummy.position.set(x, toY((bar.high + bar.low) / 2), z);
          dummy.scale.set(0.023, (bar.high - bar.low) * 0.13, 0.04);
          dummy.updateMatrix(); wicks.setMatrixAt(index, dummy.matrix); wicks.setColorAt(index, tint);
          dummy.position.set(x, -4.3 + bar.volume * 0.4, z);
          dummy.scale.set(0.105, bar.volume * 0.8, 0.34);
          dummy.updateMatrix(); volume.setMatrixAt(index, dummy.matrix);
        });
        world.add(bodies, wicks, volume);
        // A measured floor places candles in real perspective, without changing their prices.
        const gridPoints: number[] = [];
        for (let x = -10; x <= 10; x += 2) gridPoints.push(x, -4.35, -4, x, -4.35, 4);
        for (let z = -4; z <= 4; z += 1) gridPoints.push(-10, -4.35, z, 10, -4.35, z);
        const grid = remember(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(gridPoints, 3)), new THREE.LineBasicMaterial({ color: 0x275464, transparent: true, opacity: 0.45 })));
        world.add(grid);
        const decisions = new THREE.Group();
        const review = new THREE.Group();
        const landmarks = [44, 82].map((index) => {
          const bar = CANDLES[index];
          const { x, z } = position(index);
          const marker = remember(new THREE.Mesh(new THREE.OctahedronGeometry(0.25), new THREE.MeshStandardMaterial({ color: index === 44 ? 0x32d3ee : 0xfbbf24, emissive: index === 44 ? 0x083c46 : 0x4a3004, roughness: 0.25 })));
          marker.position.set(x, toY(bar.high) + 0.9, z);
          const stem = remember(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, -4.35, z), marker.position]), new THREE.LineBasicMaterial({ color: index === 44 ? 0x32d3ee : 0xfbbf24, transparent: true, opacity: 0.6 })));
          decisions.add(marker, stem);
          const ring = remember(new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.022, 6, 48), new THREE.MeshBasicMaterial({ color: 0x32d3ee })));
          ring.rotation.x = Math.PI / 2;
          ring.position.set(x, -4.3, z);
          decisions.add(ring);
          return marker.position.clone();
        });
        const trail = remember(new THREE.Line(new THREE.BufferGeometry().setFromPoints([landmarks[0], new THREE.Vector3(landmarks[0].x, landmarks[1].y, landmarks[0].z), landmarks[1]]), new THREE.LineBasicMaterial({ color: 0x32d3ee })));
        review.add(trail);
        const stop = remember(new THREE.Mesh(new THREE.BoxGeometry(6.85, 0.035, 0.4), new THREE.MeshBasicMaterial({ color: 0xfb7185, transparent: true, opacity: 0.7 })));
        stop.position.set(2.8, toY(CANDLES[44].low) - 0.3, position(44).z);
        decisions.add(stop);
        world.add(decisions, review);

        const render = () => {
          frame = 0;
          if (disposed || !renderer || !visible || document.hidden) return;
          const rect = host.getBoundingClientRect();
          scroll = reducedMotion ? 0 : Math.max(-1, Math.min(1, (window.innerHeight * 0.45 - rect.top) / window.innerHeight));
          const angle = 0.28 + yaw + scroll * 0.13;
          const distance = Math.max(14, 28 / camera.aspect);
          camera.position.set(Math.sin(angle) * distance, distance * 0.34 + pitch * 6 + scroll * 0.9, Math.cos(angle) * distance);
          camera.lookAt(0, -0.8, 0);
          world.rotation.y = -0.08;
          renderer.render(scene, camera);
          host.dataset.camera = `${yaw.toFixed(2)},${pitch.toFixed(2)}`;
          host.dataset.renderCount = String(Number(host.dataset.renderCount ?? 0) + 1);
        };
        const requestRender = () => { if (!disposed && visible && !document.hidden && !frame) frame = window.requestAnimationFrame(render); };
        const orbit = (x: number, y: number) => { yaw = Math.max(-0.42, Math.min(0.42, yaw + x)); pitch = Math.max(-0.3, Math.min(0.3, pitch + y)); requestRender(); };
        const setChapter = (value: Chapter) => { decisions.visible = value !== "price"; review.visible = value === "review"; requestRender(); };
        controlRef.current = { chapter: setChapter, orbit, reset() { yaw = 0; pitch = 0; requestRender(); } };
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
        const pointerDown = (event: PointerEvent) => {
          // Vertical touch gestures keep scrolling the page; use the buttons on mobile.
          if (event.pointerType === "touch" || event.button !== 0) return;
          dragging = { id: event.pointerId, x: event.clientX, y: event.clientY };
          mount.setPointerCapture(event.pointerId);
        };
        const pointerMove = (event: PointerEvent) => { if (!dragging || event.pointerId !== dragging.id) return; orbit((event.clientX - dragging.x) * 0.004, (event.clientY - dragging.y) * 0.003); dragging = { id: event.pointerId, x: event.clientX, y: event.clientY }; };
        const pointerUp = () => { if (dragging && mount.hasPointerCapture(dragging.id)) mount.releasePointerCapture(dragging.id); dragging = null; };
        const contextLost = (event: Event) => { event.preventDefault(); setStatus("fallback"); window.cancelAnimationFrame(frame); frame = 0; visible = false; host.dataset.sceneActive = "false"; };
        mount.addEventListener("pointerdown", pointerDown);
        mount.addEventListener("pointermove", pointerMove);
        mount.addEventListener("pointerup", pointerUp);
        mount.addEventListener("pointercancel", pointerUp);
        canvas.addEventListener("webglcontextlost", contextLost);
        document.addEventListener("visibilitychange", visibility);
        if (!reducedMotion) window.addEventListener("scroll", requestRender, { passive: true });
        resize();
        host.dataset.candleCount = String(CANDLES.length);
        host.dataset.sceneActive = "true";
        setStatus("ready");
        cleanScene = () => {
          window.cancelAnimationFrame(frame);
          pointerUp();
          resizeObserver.disconnect(); visibilityObserver.disconnect();
          mount.removeEventListener("pointerdown", pointerDown); mount.removeEventListener("pointermove", pointerMove); mount.removeEventListener("pointerup", pointerUp); mount.removeEventListener("pointercancel", pointerUp);
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

  return <section className={`min-w-0 ${className}`} ref={hostRef} data-market-sculpture data-scene-status={status} data-chapter={chapter} aria-label="Explore a market session in three dimensions">
    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400"><span className="font-data">96 candles / one example session</span><span>Synthetic data · 3D study</span></div>
    <div className="relative mt-1 h-[260px] sm:h-[280px] lg:h-[230px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200" tabIndex={0} role="group" aria-label="Rotate the market scene" aria-describedby="market-sculpture-instructions" onKeyDown={(event) => {
      const delta = ORBIT_KEYS[event.key];
      if (delta) { event.preventDefault(); controlRef.current?.orbit(delta[0], delta[1]); }
      if (event.key === "Home") { event.preventDefault(); controlRef.current?.reset(); }
    }}>
      <div className={`absolute inset-0 cursor-grab rounded-md focus-visible:outline-none ${status === "fallback" ? "invisible" : ""}`} ref={canvasRef} />
      {status !== "ready" ? <div className="absolute inset-0 flex flex-col justify-center border-y border-cyan-300/15 px-6 text-slate-300"><p className="text-xl font-medium text-white">A market. A decision. A trace.</p><p className="mt-3 text-sm leading-6">{status === "loading" ? "Preparing the dimensional study…" : "The 3D view is unavailable on this device. The example remains below; explore the working chart and journal on this page."}</p><p className="mt-3 font-data text-xs">Entry: candle 44 · Exit: candle 82</p></div> : null}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 border-y border-white/10">
      <div className="flex min-w-0" role="group" aria-label="Market scene chapters">{CHAPTERS.map((item) => <button className={`relative min-h-11 px-3 text-sm transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-200 ${item.id === chapter ? "text-cyan-100" : "text-slate-400"}`} aria-pressed={item.id === chapter} key={item.id} onClick={() => setChapter(item.id)} type="button">{item.label}{item.id === chapter ? <span className="absolute inset-x-3 bottom-0 h-px bg-cyan-200" aria-hidden="true" /> : null}</button>)}</div>
      <div className="flex"><button className="flex h-11 w-11 items-center justify-center text-slate-300 hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200" type="button" aria-label="Rotate scene left" onClick={() => controlRef.current?.orbit(-0.08, 0)}><ArrowLeft size={15} /></button><button className="flex h-11 w-11 items-center justify-center text-slate-300 hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200" type="button" aria-label="Reset scene view" onClick={() => controlRef.current?.reset()}><RotateCcw size={15} /></button><button className="flex h-11 w-11 items-center justify-center text-slate-300 hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200" type="button" aria-label="Rotate scene right" onClick={() => controlRef.current?.orbit(0.08, 0)}><ArrowRight size={15} /></button></div>
    </div>
    <div className="pt-3" aria-live="polite"><h2 className="text-sm font-medium text-white">{content.title}</h2><p className="mt-1 max-w-xl text-xs leading-5 text-slate-300">{content.detail}</p></div>
    <p className="mt-2 text-[10px] leading-4 text-slate-400" id="market-sculpture-instructions">Drag or use arrow keys to change perspective. Home resets. Prices remain fixed.</p>
  </section>;
}
