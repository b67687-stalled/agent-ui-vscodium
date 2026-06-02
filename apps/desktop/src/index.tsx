/**
 * agent-ui — Application entry point.
 *
 * CopilotKit root provider wraps the entire app so that all
 * CopilotKit V2 components (CopilotChatMessageView, CopilotChatInput,
 * CopilotChatConfigurationProvider) have access to the CopilotKit context.
 *
 * We set runtimeUrl to our own backend so CopilotKit doesn't try to
 * connect to the CopilotCloud service. Actual SSE streaming is managed
 * separately by useAgUiStream.
 */

import React from "react";
import ReactDOM from "react-dom/client";
import { CopilotKit } from "@copilotkit/react-core/v2";
import App from "./App";
import "./index.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <CopilotKit runtimeUrl="http://localhost:8000/ag-ui">
      <App />
    </CopilotKit>
  </React.StrictMode>,
);
