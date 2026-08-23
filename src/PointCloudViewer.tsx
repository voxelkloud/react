import type { BrotliDecompress } from "@voxelkloud/format-potree";
import { createPointCloudView } from "@voxelkloud/view";
import type {
  ColorMode,
  EdlOptions,
  LodOptions,
  PointCloudView,
  PointMaterialOptions,
  ViewStats,
} from "@voxelkloud/view";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { usePointCloud } from "./use-point-cloud.js";
import type { PointCloudStatus } from "./use-point-cloud.js";

export interface PointCloudViewerProps {
  /** Directory URL or `metadata.json` URL. Both are accepted. */
  readonly url: string;
  readonly className?: string;
  readonly style?: CSSProperties;
  /** LOD policy. `targetScreenError` is the primary quality control. */
  readonly lod?: LodOptions;
  /**
   * Colour mode. Defaults to the cloud's own RGB when it has any, and to an
   * elevation ramp when it does not — LAS point format 1 carries intensity and
   * classification and no colour, which is most 3DEP lidar.
   */
  readonly colorMode?: ColorMode;
  readonly material?: PointMaterialOptions;
  /**
   * Eye-dome lighting. Omitted means off.
   *
   * Whether the pass EXISTS is fixed when the view is built, so switching
   * between `undefined` and an object rebuilds the renderer. Changing the
   * numbers inside it does not — those are uniform writes.
   */
  readonly edl?: EdlOptions;
  /** Needed for BROTLI clouds; no browser exposes a brotli decoder to JS. */
  readonly decompress?: BrotliDecompress;
  /** `"arena"` (default) batches nodes into slabs; `"per-node"` is the fallback. */
  readonly sinkMode?: "arena" | "per-node";
  /** Attach `three/addons` OrbitControls. Default `true`. */
  readonly controls?: boolean;
  /** Called once per rendered frame with the LIVE stats object. */
  readonly onStats?: (stats: ViewStats) => void;
  /** Called once the view exists, for imperative escape hatches. */
  readonly onReady?: (view: PointCloudView) => void;
  readonly onError?: (error: unknown) => void;
  /** Rendered while loading or on failure. Receives the raw status. */
  readonly renderOverlay?: (status: PointCloudStatus) => React.ReactNode;
}

/**
 * A point cloud in a canvas.
 *
 * Deliberately thin: everything below it is `@voxelkloud/view`, which knows
 * nothing about React, so the same viewer drives a Vue or vanilla host without
 * a second implementation. This owns exactly the things React should own — the
 * canvas element, the effect lifecycle, and turning props into idempotent
 * setter calls.
 */
export function PointCloudViewer({
  url,
  className,
  style,
  lod,
  colorMode,
  material,
  edl,
  decompress,
  sinkMode,
  controls = true,
  onStats,
  onReady,
  onError,
  renderOverlay,
}: PointCloudViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<PointCloudView | undefined>(undefined);
  const [failure, setFailure] = useState<unknown>(undefined);
  const cloud = usePointCloud(url, decompress === undefined ? {} : { decompress });

  // Callbacks through refs: a caller passing an inline arrow must not tear the
  // renderer down and rebuild it on every parent render.
  const cbs = useRef({ onStats, onReady, onError });
  cbs.current = { onStats, onReady, onError };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || cloud.kind !== "ready") return;

    let cancelled = false;
    let raf = 0;
    let disposeControls: (() => void) | undefined;
    let view: PointCloudView | undefined;
    let tickControls: (() => void) | undefined;

    (async () => {
      try {
        const hasColor = cloud.source.attributes.some(
          (a) => a.role === "color",
        );
        view = createPointCloudView({
          canvas,
          ...(lod !== undefined ? { lod } : {}),
          ...(decompress !== undefined ? { decompress } : {}),
          ...(sinkMode !== undefined ? { sinkMode } : {}),
          ...(edl !== undefined ? { edl } : {}),
          material: {
            ...(hasColor ? {} : { colorMode: { kind: "elevation" as const } }),
            ...(colorMode !== undefined ? { colorMode } : {}),
            ...material,
          },
        });
        await view.init();
        if (cancelled) {
          view.dispose();
          return;
        }
        viewRef.current = view;
        view.addCloud(cloud.source, cloud.hierarchy, cloud.openPoints);
        view.frameCloud(0);

        const resize = () => {
          const r = canvas.getBoundingClientRect();
          view?.setSize(
            Math.max(r.width, 1),
            Math.max(r.height, 1),
            Math.min(globalThis.devicePixelRatio ?? 1, 2),
          );
        };
        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(canvas);
        disposeControls = () => observer.disconnect();

        if (controls) {
          // Lazily imported so the core module graph never pulls examples/jsm.
          const { OrbitControls } = await import(
            "three/addons/controls/OrbitControls.js"
          );
          if (!cancelled) {
            const c = new OrbitControls(view.camera, canvas);
            c.enableDamping = true;
            c.dampingFactor = 0.08;
            c.zoomToCursor = true;
            c.target.copy(view.targetFor(0));
            c.update();
            const prev = disposeControls;
            disposeControls = () => {
              prev?.();
              c.dispose();
            };
            tickControls = () => c.update();
          }
        }

        cbs.current.onReady?.(view);

        const tick = () => {
          raf = requestAnimationFrame(tick);
          tickControls?.();
          view?.renderFrame();
          if (view !== undefined) cbs.current.onStats?.(view.stats);
        };
        raf = requestAnimationFrame(tick);
      } catch (error) {
        if (cancelled) return;
        setFailure(error);
        cbs.current.onError?.(error);
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      disposeControls?.();
      view?.dispose();
      viewRef.current = undefined;
    };
    // `material` and `colorMode` are applied through setters below rather than
    // by rebuilding, so they are deliberately not dependencies here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud, controls, sinkMode, edl === undefined]);

  // Idempotent setters, so changing a quality knob does not tear down the GPU.
  // The deprecated alias is read here too, so a caller still passing
  // `targetPixelSpacing` keeps a LIVE knob rather than one that only applies at
  // mount. Resolution order matches `resolveLodOptions`.
  const targetError = lod?.targetScreenError ?? lod?.targetPixelSpacing;
  useEffect(() => {
    if (targetError !== undefined) {
      viewRef.current?.setTargetScreenError(targetError);
    }
  }, [targetError]);

  useEffect(() => {
    if (lod?.pointBudget !== undefined) {
      viewRef.current?.setPointBudget(lod.pointBudget);
    }
  }, [lod?.pointBudget]);

  useEffect(() => {
    if (edl !== undefined) viewRef.current?.setEdl(edl);
  }, [edl?.strength, edl?.radius, edl?.opacity]);

  const status: PointCloudStatus =
    failure !== undefined ? { kind: "error", error: failure } : cloud;

  return (
    <div
      className={className}
      style={{ position: "relative", ...style }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
      {status.kind !== "ready" && renderOverlay?.(status)}
    </div>
  );
}
