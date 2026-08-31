/// <reference types="vite/client" />

/** Side-effect CSS imports (KaTeX's stylesheet is loaded lazily alongside the module). */
declare module "*.css" {
  const content: string;
  export default content;
}
