# @voxelkloud/react

React bindings for [voxelkloud](https://github.com/voxelkloud/voxelkloud).

```sh
npm install @voxelkloud/react three
```

```tsx
import { PointCloudViewer } from "@voxelkloud/react";

<PointCloudViewer
  url="https://example.com/clouds/autzen/"
  style={{ position: "absolute", inset: 0 }}
  lod={{ targetPixelSpacing: 1.0, pointBudget: 3_000_000 }}
  onStats={(s) => console.log(s.frameMs, s.visiblePoints)}
/>;
```

The URL may point at the directory or at `metadata.json`.

Deliberately thin. Everything below these exports is
[@voxelkloud/view](https://github.com/voxelkloud/view), which knows nothing about React — this
package owns only the canvas element, the effect lifecycle, and turning props
into idempotent setter calls. Callbacks ride refs, so an inline arrow does not
rebuild the renderer, and the quality knobs are setters rather than remounts.

`usePointCloud` is the loader half on its own, for inspecting a cloud before
rendering it.

MIT.
