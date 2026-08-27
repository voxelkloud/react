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

/** What the loader is doing for a SET of clouds. */
export type PointCloudsStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "loading"; readonly stage: "manifest" | "hierarchy" }
  | {
      readonly kind: "ready";
      /** One entry per URL, in the order given. */
      readonly clouds: readonly {
        readonly source: PointCloudSourceBase;
        readonly hierarchy: PointCloudTreeBase;
        readonly openPoints: PointReaderFactory;
      }[];
    }
  | { readonly kind: "error"; readonly error: unknown };

/**
 * Load SEVERAL clouds, and report ready only when all of them are.
 *
 * All or nothing on purpose. A view that added clouds as each one landed would
 * frame itself on the first to arrive and then jump when a neighbouring tile
 * showed up behind the camera — and with survey tiles, "first to arrive" is
 * whichever the CDN felt like, so the opening shot would differ between
 * reloads. One barrier costs the slowest manifest and buys a stable first frame.
 *
 * The URLs are joined into the effect key rather than compared by identity, so
 * a caller may pass a fresh array literal every render without re-loading.
 */
export function usePointClouds(
  urls: readonly string[],
  options: UsePointCloudOptions = {},
): PointCloudsStatus {
  const [status, setStatus] = useState<PointCloudsStatus>({ kind: "idle" });
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const key = urls.join("\n");

  useEffect(() => {
    const list = key === "" ? [] : key.split("\n");
    if (list.length === 0) {
      setStatus({ kind: "idle" });
      return;
    }
    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      try {
        setStatus({ kind: "loading", stage: "manifest" });
        const loaded = await Promise.all(
          list.map((u) =>
            loadPointCloud(u, {
              signal: controller.signal,
              ...(optionsRef.current.decompress !== undefined
                ? { points: { decompress: optionsRef.current.decompress } }
                : {}),
            }),
          ),
        );
        if (cancelled) return;
        setStatus({ kind: "loading", stage: "hierarchy" });
        if (optionsRef.current.expandAll !== false)
          await Promise.all(loaded.map((l) => l.tree.expandAll()));
        if (cancelled) {
          // Every tree, not just the ones that finished: `Promise.all` above
          // resolves them all or none, so a cancel here leaks the whole set.
          for (const l of loaded) l.tree.dispose();
          return;
        }
        setStatus({
          kind: "ready",
          clouds: loaded.map((l) => ({
            source: l.source,
            hierarchy: l.tree,
            openPoints: l.openPoints,
          })),
        });
      } catch (error) {
        if (cancelled) return;
        setStatus({ kind: "error", error });
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [key]);

  return status;
}
