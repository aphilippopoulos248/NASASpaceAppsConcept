// GPU rendering for the browser tests in this folder (decision D-7: GPU browser runs go under
// /tmp/lunyx-gpu.lock and do not wait behind CPU jobs). With E2E_GPU=1, every Chromium that
// e2e/lib/app.mjs launches uses the GPU through ANGLE over EGL instead of SwiftShader; without
// it nothing changes. Import this module before e2e/lib/app.mjs.
//
// The patch is to the one `chromium` object both modules import from playwright, so the shared
// helpers stay as they are. (Better: a launch option in e2e/lib/app.mjs, which belongs to
// @desktop-workflow; this file goes when that exists.)
//
// Note: on a GPU the app uses its full surface settings; with SwiftShader it picks its light
// ones. Functional checks are the same; pictures differ.
import { chromium } from 'playwright';

export const GPU = process.env.E2E_GPU === '1';
export const GPU_ARGS = ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'];

if (GPU && !chromium.__lunyxGpu) {
  const launch = chromium.launch.bind(chromium);
  chromium.launch = (options = {}) => launch({ ...options, args: GPU_ARGS });
  chromium.__lunyxGpu = true;
}

/** The WebGL renderer the page reports (UNMASKED_RENDERER_WEBGL), to confirm which path ran. */
export function renderer(page) {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'no WebGL';
  });
}
