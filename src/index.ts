// @voxelkloud/react — React bindings over @voxelkloud/view.
//
// Deliberately thin. Everything below these two exports knows nothing about
// React, so a Vue or vanilla host reuses the same viewer rather than a second
// implementation of it.

export { PointCloudViewer } from "./PointCloudViewer.js";
export type { PointCloudViewerProps } from "./PointCloudViewer.js";

export { usePointCloud } from "./use-point-cloud.js";
export type {
  PointCloudStatus,
  UsePointCloudOptions,
} from "./use-point-cloud.js";

export const VOXELKLOUD_REACT_VERSION = "0.0.0";
