import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 350,
    rollupOptions: {
      output: {
        manualChunks: {
          stellar: ["@stellar/stellar-sdk"],
          vendor: ["react", "react-dom", "react-router-dom"],
        },
      },
    },
  },
});
