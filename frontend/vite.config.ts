import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The site lives under a path (https://itb2bhost.ru/tendergo); must match BASE_PATH of the backend and Caddy.
const basePath = `/${(process.env.BASE_PATH ?? "/tendergo").replace(/^\/+|\/+$/g, "")}`;

export default defineConfig({
  base: `${basePath}/`,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      [`${basePath}/api`]: {
        target: "http://localhost:3000",
        rewrite: (path) => path.slice(basePath.length),
      },
    },
  },
});
