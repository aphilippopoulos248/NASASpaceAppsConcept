/** Keep wheel/pinch input on the visible 3D canvas. Trackpads can keep sending a
 * wheel gesture to its original target after the pointer moves over a panel. */
export function guardSceneZoom(canvas: HTMLCanvasElement): void {
  const doc = canvas.ownerDocument;
  doc.addEventListener('wheel', (event) => {
    const onScene = event.target === canvas && doc.elementFromPoint(event.clientX, event.clientY) === canvas;
    if (onScene) return;

    // Ctrl+wheel is also how browsers report trackpad pinches. Over UI it must
    // neither zoom the document nor reach the scene's controls.
    if (event.ctrlKey || event.target === canvas) event.preventDefault();
    if (event.target === canvas) event.stopImmediatePropagation();
    // Ordinary scrolling over the conversation, fields and other panels keeps
    // its default behaviour and still reaches the panel's own listeners.
  }, { capture: true, passive: false });

  // Safari exposes trackpad pinch as gesture events instead of Ctrl+wheel.
  for (const type of ['gesturestart', 'gesturechange']) {
    doc.addEventListener(type, (event) => {
      if (event.target !== canvas) event.preventDefault();
    }, { capture: true, passive: false });
  }
}
