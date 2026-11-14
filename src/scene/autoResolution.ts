// Automatic resolution for the surface view. If frames run slow the picture is rendered a
// little smaller and scaled up, and restored when there is headroom again. Detail in the
// scene itself is never reduced.
// This came from the main branch, where it sat in main.ts next to the frame loop. Here the
// scene host drives it (it owns the renderer and the loop) and the surface HUD shows it.

/** The picture is never rendered below this fraction of full resolution. */
export const MIN_RESOLUTION_SCALE = 0.6;

export class AutoResolution {
  /** Fraction of full resolution being rendered, MIN_RESOLUTION_SCALE..1. */
  scale = 1;
  /** Smoothed duration of a frame, seconds. */
  frameTime = 1 / 60;
  private framesSinceTune = 0;
  private holdUntilMs = 0;
  private apply: (scale: number) => void = () => undefined;

  /** `apply` is called with the new scale whenever it changes (it sets the renderer's pixel ratio). */
  attach(apply: (scale: number) => void): void {
    this.apply = apply;
  }

  /**
   * Call once per rendered frame of the surface view. `dt` is the frame's duration in seconds,
   * as capped at 0.1 by the frame loop; `nowMs` is the frame's timestamp.
   */
  tune(dt: number, nowMs: number): void {
    // A very long frame means the tab was in the background or stalled, not that rendering is slow.
    if (dt >= 0.099) return;
    this.frameTime += (dt - this.frameTime) * 0.08;
    if (++this.framesSinceTune < 30) return;
    this.framesSinceTune = 0;
    if (this.frameTime > 1 / 50 && this.scale > MIN_RESOLUTION_SCALE) {
      this.set(Math.max(MIN_RESOLUTION_SCALE, this.scale - 0.1));
      this.holdUntilMs = nowMs + 5000; // do not climb straight back up
    } else if (this.frameTime < 1 / 58 && this.scale < 1 && nowMs > this.holdUntilMs) {
      this.set(Math.min(1, this.scale + 0.05));
    }
  }

  /** Back to full resolution: called on leaving the surface view. */
  reset(): void {
    this.set(1);
  }

  /** For the HUD: "60 fps", or "41 fps, 80% resolution" while the picture is rendered smaller. */
  get statusText(): string {
    const fps = Math.round(1 / this.frameTime);
    return this.scale < 1 ? `${fps} fps, ${Math.round(this.scale * 100)}% resolution` : `${fps} fps`;
  }

  private set(scale: number): void {
    this.scale = scale;
    this.apply(scale);
  }
}

/** The one tuner for the app's renderer: driven by the scene host, read by the surface HUD. */
export const surfaceResolution = new AutoResolution();
