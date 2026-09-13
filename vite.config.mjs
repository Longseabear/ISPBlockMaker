import { defineConfig } from "vite";
export default defineConfig({
  server: {
    watch: {
      ignored: [
        "**/.isp/**",
        "**/workspace/**",
        "**/tests/**",
        "**/docs/**",
        "**/server/**",
      ],
    },
  },
  build: { outDir: "dist" },
});
