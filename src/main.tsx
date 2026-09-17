// First, before anything that might call one of the methods it supplies.
import "./lib/compat";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { suppressContextMenu } from "./lib/contextMenu";
import "./styles/tokens.css";
import "./styles/global.css";

// No right-click menu in any build (owner's request; see contextMenu.ts).
suppressContextMenu(window);

const container = document.getElementById("root");
if (!container) {
  throw new Error("missing #root");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
