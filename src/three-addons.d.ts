// @types/three declares `three/examples/jsm/*` but not the `three/addons/*`
// alias, which is the documented path and the one bundlers resolve.
declare module "three/addons/controls/OrbitControls.js" {
  export { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
}
