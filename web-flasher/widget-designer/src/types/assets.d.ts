// Vite serves `?url` imports as a string path. TypeScript needs telling, since
// these are firmware images resolved from outside the app's own source tree.
declare module "*.bin?url" {
  const url: string;
  export default url;
}
