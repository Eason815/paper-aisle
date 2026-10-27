import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env };
  const publishable = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (publishable && !publishable.startsWith("sb_publishable_")) {
    throw new Error("Use a Supabase publishable key for the browser; privileged and legacy keys are rejected.");
  }
  if (env.VITE_CLOUD_SYNC_NAMESPACE && !/^[a-z0-9_-]{1,40}$/i.test(env.VITE_CLOUD_SYNC_NAMESPACE)) {
    throw new Error("Invalid cloud sync namespace.");
  }
  return {
    base: "./",
    plugins: [react()],
    build: { rollupOptions: { output: { manualChunks(id: string) { if (id.includes("/@supabase/")) return "supabase"; } } } },
  };
});
