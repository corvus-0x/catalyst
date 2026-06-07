import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
    plugins: [react()],
    base: process.env.NODE_ENV === "production" ? "/static/frontend/" : "/",
    server: {
        host: "0.0.0.0",
        port: 5174,
        // hmr.host must be the address the BROWSER uses to open the WebSocket,
        // not the container hostname. Without this, HMR fails in Docker because
        // the browser cannot reach the container's internal hostname.
        hmr: {
            host: "localhost",
            port: 5174,
        },
        proxy: {
            "/api": {
                target: process.env.VITE_API_URL || "http://127.0.0.1:8000",
                changeOrigin: true,
                timeout: 600000,
                proxyTimeout: 600000,
            },
            "/media": {
                target: process.env.VITE_API_URL || "http://127.0.0.1:8000",
                changeOrigin: true,
            },
        },
    },
    test: {
        environment: "jsdom",
        globals: true,
        setupFiles: ["./src/test/setup.ts"],
    },
});
