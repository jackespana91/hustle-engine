import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/three/examples/")) return "three-loaders";
          if (id.includes("/node_modules/three/")) return "three-runtime";
          if (id.includes("/packages/routerun/")) return "hustle-routerun";
          if (id.includes("/packages/core/")) return "hustle-core";
          return undefined;
        },
      },
    },
  },
});
