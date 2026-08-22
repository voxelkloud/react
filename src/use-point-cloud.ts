import type {
  BrotliDecompress,
  PointCloudHierarchy,
  PointCloudSource,
} from "@voxelkloud/loader";
import { loadHierarchy, loadPointCloudSource } from "@voxelkloud/loader";
import { useEffect, useRef, useState } from "react";

/** What the loader is doing right now. */
export type PointCloudStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "loading"; readonly stage: "manifest" | "hierarchy" }
  | {
      readonly kind: "ready";
      readonly source: PointCloudSource;
      readonly hierarchy: PointCloudHierarchy;
    }
  | { readonly kind: "error"; readonly error: unknown };

export interface UsePointCloudOptions {
  /**
   * Expand the WHOLE hierarchy before reporting ready.
   *
   * Default `true`, and cheap: Task 3's policy buys the entire hierarchy.bin in
   * one request, so this is parsing already-resident bytes rather than more
   * I/O — 100 KB and ~2 ms for autzen. With it off, descent expands chunks as
   * the camera reaches them.
   */
  readonly expandAll?: boolean;
  /**
   * A brotli decompressor, needed for BROTLI clouds because no browser exposes
   * one to JS. Ignored for uncompressed clouds.
   *
   * ```ts
   * const { brotliDecompress } = await import("@voxelkloud/loader/brotli");
   * ```
   */
  readonly decompress?: BrotliDecompress;
}

/**
 * Load a point cloud's manifest and hierarchy.
 *
 * Separate from the viewer component so a caller can inspect the source before
 * rendering it — attribute list, point count, bounds, `source.warnings` — or
 * drive a non-React renderer with the same data. The component below is a thin
 * wrapper over this plus `@voxelkloud/view`.
 *
 * Cancels cleanly: a URL change or an unmount aborts whatever is in flight and
 * the stale result is discarded rather than committed to state.
 */
export function usePointCloud(
  url: string | undefined,
  options: UsePointCloudOptions = {},
): PointCloudStatus {
  const [status, setStatus] = useState<PointCloudStatus>({ kind: "idle" });
  // Read through a ref so a caller passing an inline object literal does not
  // re-trigger the load on every render.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (url === undefined) {
      setStatus({ kind: "idle" });
      return;
    }
    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      try {
        setStatus({ kind: "loading", stage: "manifest" });
        const source = await loadPointCloudSource(url, {
          signal: controller.signal,
        });
        if (cancelled) return;

        setStatus({ kind: "loading", stage: "hierarchy" });
        const hierarchy = await loadHierarchy(source, {
          signal: controller.signal,
        });
        if (cancelled) return;

        if (optionsRef.current.expandAll !== false) await hierarchy.expandAll();
        if (cancelled) {
          hierarchy.dispose();
          return;
        }
        setStatus({ kind: "ready", source, hierarchy });
      } catch (error) {
        if (cancelled) return;
        setStatus({ kind: "error", error });
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [url]);

  return status;
}
