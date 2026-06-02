import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 3000,
      host: "0.0.0.0",
      proxy: {
        "/v2": {
          target: "http://localhost:8000",
          changeOrigin: true,
        },
        "/api": {
          target: "http://localhost:8000",
          changeOrigin: true,
        },
        "/ag-ui": {
          target: "http://localhost:8000",
          changeOrigin: true,
        },
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
  };
});
