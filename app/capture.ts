/**
 * THE PLATE CAPTURE HOOK — one supersampled frame, properly downsampled. L30 P4a.1.
 *
 * WHY THIS EXISTS. Ghost anatomy is resolved by alphaHash COVERAGE, not by blending (see
 * `materialFor` in app/scene.tsx for why blending has no correct draw order here): a
 * fragment at opacity 0.4 survives with probability 0.4 and is discarded otherwise. One
 * sample per pixel is therefore binary noise, and P4a's cure — drawing the backing store at
 * 2x and letting the COMPOSITOR downsample it — buys exactly four samples per output pixel.
 *
 * MEASURED, 2026-09-07, on the live plate: four samples is not enough. At context 0.40 the
 * output is 5-level noise with a standard deviation of 0.245 around the mean, which is
 * precisely the grainy dot-cloud Adrian asked about ("为什么蒙蒙？"). Sixteen samples halves
 * that; the numbers are in the worklog.
 *
 * Raising the LIVE canvas to 4x would not help, because the compositor's own downscale is a
 * bilinear tap: at exactly 2:1 it averages a 2x2 block (which is why 2x worked at all), but
 * at 4:1 it still reads four texels out of sixteen and the extra samples are thrown away.
 * The cure has to do its own area filter, which is what a 2D canvas `drawImage` at
 * `imageSmoothingQuality:'high'` is.
 *
 * WHAT IT DOES NOT DO. It does not change the page's viewport (the plate size picks the
 * responsive breakpoint, and moving it would reframe the subject), it does not change the
 * camera's aspect (the CSS box is untouched — only the backing store grows), and it does not
 * draw the caption. The caption is a DOM card governed by `burn_caption`, which defaults to
 * TRUE; a capture that returned only the 3D layer would silently drop it from every plate.
 * So the downsampled bitmap is ALSO painted over the live canvas, and the renderer keeps
 * taking its screenshot of the whole page — same picture, caption included, smooth ghost.
 */
import * as T from 'three';

export interface CaptureRequest {
  /** Output width in CSS pixels. Defaults to the canvas's live size. */
  w?: number;
  /** Output height in CSS pixels. Defaults to the canvas's live size. */
  h?: number;
  /** Supersample factor: the backing store is drawn at `scale`x and area-averaged down. */
  scale?: number;
}

/** Clamped, because the backing store is `scale`x in BOTH axes: 4 is already 16 megapixels
 *  for a 960x720 plate, and a WebGL renderbuffer over the driver's limit fails as a blank
 *  frame, not as an error. */
const MIN_SCALE = 1;
const MAX_SCALE = 4;
const OVERLAY_CLASS = 'atlas-shot';

/** Removes the painted overlay, if there is one. Set by `installCapture`, and called by the
 *  page on EVERY re-drive: a warm tab that kept a previous request's overlay would be
 *  screenshotted as a plausible picture of the wrong scene at HTTP 200 and cached for a day.
 *  That is this fork's most expensive failure class, so the release is not optional. */
export let releaseCaptureOverlay: () => void = () => {};

interface InstallOptions {
  renderer: T.WebGLRenderer;
  scene: T.Scene;
  camera: T.Camera;
  /** The element the canvas lives in; the overlay is appended here, over the canvas. */
  host: HTMLElement;
}

/** Registers `window.__atlasCapture` / `window.__atlasCaptureRelease`. Returns a disposer. */
export function installCapture({ renderer, scene, camera, host }: InstallOptions): () => void {
  const w = window as unknown as {
    __atlasCapture?: (req?: CaptureRequest) => string;
    __atlasCaptureRelease?: () => void;
  };
  const release = () => {
    for (const old of host.querySelectorAll(`canvas.${OVERLAY_CLASS}`)) old.remove();
  };
  releaseCaptureOverlay = release;

  w.__atlasCapture = (req: CaptureRequest = {}) => {
    const view = renderer.domElement;
    // The CSS box is the output size by default. Reading it (rather than taking the
    // caller's word) is what keeps the capture the same picture the page has settled on.
    const outW = Math.max(1, Math.round(Number(req.w) || view.clientWidth));
    const outH = Math.max(1, Math.round(Number(req.h) || view.clientHeight));
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(req.scale) || 2));
    const prevRatio = renderer.getPixelRatio();
    const size = renderer.getSize(new T.Vector2());
    let url = '';
    try {
      // `updateStyle:false`: the canvas's CSS box must not move. It is the layout, the
      // ResizeObserver's input and — through camera.aspect — the framing itself. Only the
      // backing store grows.
      renderer.setPixelRatio(scale);
      renderer.setSize(size.x, size.y, false);
      renderer.render(scene, camera);

      const out = document.createElement('canvas');
      out.width = outW;
      out.height = outH;
      out.className = OVERLAY_CLASS;
      // Absolute over the WebGL canvas. `.scene canvas{width:100%;height:100%}` in
      // globals.css already sizes it; position and pointer-events are what stop it
      // becoming layout and stop it eating the explorer's orbit gestures.
      out.setAttribute('style', 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:1');
      const ctx = out.getContext('2d');
      if (!ctx) return '';
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      // IN THE SAME TASK AS THE RENDER. The renderer is built without
      // `preserveDrawingBuffer`, so the drawing buffer is valid until the next composite:
      // a drawImage one tick later copies a CLEARED buffer, and a blank plate is exactly
      // the failure this project caches for 24 hours at HTTP 200.
      ctx.drawImage(view, 0, 0, outW, outH);
      url = out.toDataURL('image/png');
      release();
      host.appendChild(out);
    } finally {
      // Restoring the ratio resizes and therefore CLEARS the backing store, so the live
      // canvas has to be redrawn here — the animate loop only draws when it is dirty, and
      // marking it dirty would clear `data-atlas-settled` under the renderer's feet.
      renderer.setPixelRatio(prevRatio);
      renderer.setSize(size.x, size.y, false);
      renderer.render(scene, camera);
    }
    return url;
  };
  w.__atlasCaptureRelease = release;

  return () => {
    release();
    releaseCaptureOverlay = () => {};
    delete w.__atlasCapture;
    delete w.__atlasCaptureRelease;
  };
}
