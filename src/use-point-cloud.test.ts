import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { usePointCloud, usePointClouds } from "./use-point-cloud.js";
import { PointCloudViewer } from "./PointCloudViewer.js";

/**
 * There is no DOM and no GPU here, so these are contract tests, not behaviour
 * tests: that the package imports cleanly in a bare Node context, that its
 * public surface is what it claims, and that nothing touches `document`,
 * `navigator` or a renderer at module scope.
 *
 * The behaviour is covered where it can actually run — `@voxelkloud/view`'s
 * suite for the scheduler and material, and the browser for the rest.
 */
describe("@voxelkloud/react module contract", () => {
  it("imports with no DOM present", () => {
    expect(typeof globalThis.document).toBe("undefined");
    expect(typeof usePointCloud).toBe("function");
    expect(typeof usePointClouds).toBe("function");
    expect(typeof PointCloudViewer).toBe("function");
  });

  it("exports exactly its documented surface", async () => {
    const mod = await import("./index.js");
    expect(Object.keys(mod).sort()).toEqual([
      "PointCloudViewer",
      "VOXELKLOUD_REACT_VERSION",
      "usePointCloud",
      "usePointClouds",
    ]);
  });

  it("constructs no renderer at module scope", () => {
    // A viewer built at import time would need a canvas, which is the failure
    // that breaks SSR and every Node test in a consuming app.
    const src = readFileSync(
      new URL("./PointCloudViewer.tsx", import.meta.url),
      "utf8",
    );
    // Every call must sit inside the effect, never at the top level.
    const topLevelCall = /^createPointCloudView\(/m.test(src);
    expect(topLevelCall).toBe(false);
    expect(src).toContain("useEffect");
  });

  it("keeps three/addons behind a dynamic import", () => {
    // A static import would pull examples/jsm into every bundle, including the
    // ones that pass `controls={false}`.
    const src = readFileSync(
      new URL("./PointCloudViewer.tsx", import.meta.url),
      "utf8",
    );
    expect(src).toContain('await import(');
    expect(/^import .*three\/addons/m.test(src)).toBe(false);
  });
});
