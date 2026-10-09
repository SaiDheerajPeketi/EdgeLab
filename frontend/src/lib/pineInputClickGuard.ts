/** A completed chart gesture must not click controls that replace the picker. */
export function guardPineInputCompletionClick(document: Document, { clientX, clientY }: { clientX: number; clientY: number }) {
  const view = document.defaultView;
  if (!view || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return () => {};
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    view.clearTimeout(timer);
    document.removeEventListener("click", click, true);
    document.removeEventListener("pointerdown", stop, true);
    document.removeEventListener("keydown", stop, true);
  };
  const click = (event: MouseEvent) => {
    // Keyboard/assistive clicks remain available. A fresh pointerdown removes
    // this guard before a deliberate new tap, even at exactly the same point.
    if (!(event.detail > 0) || Math.abs(event.clientX - clientX) > 2 || Math.abs(event.clientY - clientY) > 2) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    stop();
  };
  const timer = view.setTimeout(stop, 750);
  document.addEventListener("click", click, true);
  document.addEventListener("pointerdown", stop, true);
  document.addEventListener("keydown", stop, true);
  return stop;
}
