import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(env.VITE_SUPABASE_URL),
      "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(env.VITE_SUPABASE_ANON_KEY),
      "import.meta.env.VITE_API_URL": JSON.stringify(env.VITE_API_URL),
      "import.meta.env.VITE_ADMIN_EMAIL": JSON.stringify(env.VITE_ADMIN_EMAIL),
    },
    plugins: [
      tanstackStart({
        server: { entry: "src/server.ts" },
      }),
      tailwindcss(),
      react(),
      tsconfigPaths(),
      nodePolyfills({
        globals: { global: true, Buffer: true, process: true },
        protocolImports: true,
      }),
    ],
  };
});
