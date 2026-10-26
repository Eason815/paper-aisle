import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cleanRecord, type CloudRecord, type CloudTransport } from "./model";

export type CloudConfig = { enabled: boolean; url: string; key: string; issue: string };
export function cloudConfig(env: Record<string, unknown> = {
  VITE_ENABLE_CLOUD_SYNC: import.meta.env.VITE_ENABLE_CLOUD_SYNC,
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
}): CloudConfig {
  const enabled = env.VITE_ENABLE_CLOUD_SYNC === "true";
  const url = String(env.VITE_SUPABASE_URL ?? "");
  const key = String(env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "");
  if (!enabled) return { enabled: false, url: "", key: "", issue: "" };
  try {
    if (new URL(url).protocol !== "https:" || !key.startsWith("sb_publishable_")) throw new Error();
    return { enabled, url, key, issue: "" };
  } catch { return { enabled: false, url: "", key: "", issue: "云端配置不完整，当前继续使用本地记录。" }; }
}
const config = cloudConfig();
export const cloudClient = config.enabled ? createClient(config.url, config.key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "paper-aisle:auth:v1" },
}) : null;
export const cloudConfigIssue = config.issue;

function failure(error: { status?: number; code?: string }): Error {
  if (error.status === 401 || error.code === "PGRST301" || error.code === "PGRST303") return new Error("登录已失效，请重新登录；本机待同步记录仍保留。");
  if (error.code === "42501") return new Error("此账号未获同步权限，请在管理端核对允许账号。");
  return new Error("暂时无法连接云端，记录已保留本机，请重试。");
}
type Row = { paper_id: string; data: unknown; revision: number; updated_at: string };
function row(record: Row): CloudRecord {
  return { paperId: record.paper_id, data: cleanRecord(record.data), revision: record.revision, updatedAt: record.updated_at };
}
export async function verifySyncAccess(client: SupabaseClient): Promise<void> {
  const { data, error } = await client.rpc("paper_aisle_sync_access").abortSignal(AbortSignal.timeout(10000));
  if (error) throw failure(error);
  if (data !== true) throw new Error("此账号未获同步权限，请在管理端核对允许账号。");
}
export function transportFor(client: SupabaseClient, userId: string, datasetId: string): CloudTransport {
  return {
    async list() {
      await verifySyncAccess(client);
      const result: CloudRecord[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await client.from("paper_reading_records").select("paper_id,data,revision,updated_at")
          .eq("user_id", userId).eq("dataset_id", datasetId).order("paper_id").range(offset, offset + 499).abortSignal(AbortSignal.timeout(10000));
        if (error) throw failure(error);
        result.push(...(data as Row[]).map(row));
        if (data.length < 500) return result;
      }
    },
    async write(paperId, value, expectedRevision) {
      const { data, error } = await client.rpc("paper_aisle_write_record", {
        p_dataset_id: datasetId, p_paper_id: paperId, p_data: cleanRecord(value), p_expected_revision: expectedRevision,
      }).abortSignal(AbortSignal.timeout(10000));
      if (error) throw failure(error);
      return { applied: data.applied === true, record: row(data.record as Row) };
    },
  };
}
