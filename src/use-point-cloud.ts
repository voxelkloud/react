// UNPINNED. These bindings used to force `format: "potree-v2"` because the
// renderer decoded node payloads through that driver and nothing else would
// have worked. `PointReader` removed that constraint, so the URL now decides:
// whichever driver the application registered and the URL matches.
import type {
  NodeDecompress,
  PointCloudSourceBase,
  PointCloudTreeBase,
  PointReaderFactory,
} from "@voxelkloud/core";
import { loadPointCloud } from "@voxelkloud/loader";
import { useEffect, useRef, useState } from "react";

/** What the loader is doing right now. */
export type PointCloudStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "loading"; readonly stage: "manifest" | "hierarchy" }
  | {
      readonly kind: "ready";
      readonly source: PointCloudSourceBase;
      readonly hierarchy: PointCloudTreeBase;
      /** Opens a reader for this cloud's node payloads. Pass it to `addCloud`. */
      readonly openPoints: PointReaderFactory;
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
   * A whole-payload decompressor, needed for a BROTLI Potree cloud or a
   * zstandard EPT one because no browser exposes either codec to JS. Ignored by
   * a driver that needs none.
   *
   * ```ts
   * const { brotliDecompress } = await import("@voxelkloud/loader/brotli");
   * ```
   */
  readonly decompress?: NodeDecompress;
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
        // One call: identify the format, load the source AND open the tree.
        // Splitting it would put the format switch back in this component —
        // knowing which driver won is exactly what the registry removes.
        const {
          source,
          tree: hierarchy,
          openPoints,
        } = await loadPointCloud(url, {
          signal: controller.signal,
          ...(optionsRef.current.decompress !== undefined
            ? { points: { decompress: optionsRef.current.decompress } }
            : {}),
        });
        if (cancelled) return;
        setStatus({ kind: "loading", stage: "hierarchy" });

        if (optionsRef.current.expandAll !== false) await hierarchy.expandAll();
        if (cancelled) {
          hierarchy.dispose();
          return;
        }
        setStatus({ kind: "ready", source, hierarchy, openPoints });
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
