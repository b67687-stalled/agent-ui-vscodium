/**
 * agent-ui — Application entry point.
 *
 * ThemeProvider wraps the entire app for light/dark theme switching.
 * No CopilotKit runtime — we use custom SSE-driven chat with Zustand.
 */

import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "./providers/ThemeProvider";
import App from "./App";
import "./index.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
