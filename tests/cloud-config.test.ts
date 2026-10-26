import { describe, expect, it } from "vitest";
import { cloudConfig } from "../src/cloud/client";
describe("cloud configuration", () => {
  it("keeps cloud optional and never accepts a privileged key in the browser", () => {
    expect(cloudConfig({}).enabled).toBe(false);
    expect(cloudConfig({ VITE_ENABLE_CLOUD_SYNC: "true" }).enabled).toBe(false);
    expect(cloudConfig({ VITE_ENABLE_CLOUD_SYNC: "true", VITE_SUPABASE_URL: "https://example.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_test" }).enabled).toBe(false);
    expect(cloudConfig({ VITE_ENABLE_CLOUD_SYNC: "true", VITE_SUPABASE_URL: "https://example.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" }).enabled).toBe(true);
  });
});
