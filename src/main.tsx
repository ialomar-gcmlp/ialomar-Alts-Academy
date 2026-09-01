import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { useApp } from "./state/store";
import "./styles/index.css";

// Dev-only inspection handle. Verifying time accounting means reading the live clock,
// not guessing from the DOM. Stripped from production by the `import.meta.env.DEV`
// branch, which Vite folds to `false` and removes.
if (import.meta.env.DEV) {
  (window as unknown as { __alts: typeof useApp }).__alts = useApp;
}

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
