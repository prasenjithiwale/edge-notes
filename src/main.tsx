import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { suppressContextMenu } from "./lib/contextMenu";
import "./styles/tokens.css";
import "./styles/global.css";

// Brief 7.5: production only, so Inspect Element stays reachable in dev.
if (import.meta.env.PROD) {
  suppressContextMenu(window);
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("missing #root");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
