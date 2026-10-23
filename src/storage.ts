import type { PaperUserState, UserStateMap } from "./types";
import { z } from "zod";

const personalStateSchema = z.object({
  favorite: z.boolean().optional(),
  favoritedAt: z.number().finite().nonnegative().optional(),
  readingStatus: z.enum(["unread", "reading", "read"]).optional(),
  note: z.string().optional(),
  tags: z.array(z.string()).optional(),
}).strict();

const backupSchema = z.object({
  format: z.literal("paper-aisle-user-state"),
  version: z.literal(1),
  datasetId: z.string().min(1),
  exportedAt: z.string().datetime({ offset: true }),
  state: z.record(personalStateSchema),
}).strict();

export type UserStateBackup = z.infer<typeof backupSchema>;
export type RestorePreference = "current" | "backup";

export function storageKey(datasetId: string): string {
  return `paper-aisle:${datasetId}:user-state:v1`;
}

function parseStoredState(value: string | null): UserStateMap | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function loadUserState(datasetId: string, legacyDatasetIds: string[] = []): UserStateMap {
  const current = parseStoredState(localStorage.getItem(storageKey(datasetId)));
  if (current) return current;

  for (const legacyDatasetId of legacyDatasetIds) {
    const legacy = parseStoredState(localStorage.getItem(storageKey(legacyDatasetId)));
    if (legacy) {
      localStorage.setItem(storageKey(datasetId), JSON.stringify(legacy));
      return legacy;
    }
  }
  return {};
}

export function createBackup(datasetId: string, state: UserStateMap): UserStateBackup {
  return backupSchema.parse({
    format: "paper-aisle-user-state",
    version: 1,
    datasetId,
    exportedAt: new Date().toISOString(),
    state,
  });
}

export function parseBackup(text: string, datasetId: string): UserStateBackup {
  let input: unknown;
  try { input = JSON.parse(text); } catch { throw new Error("备份不是有效的 JSON 文件。"); }
  const parsed = backupSchema.safeParse(input);
  if (!parsed.success) throw new Error("备份格式或记录字段无效，请使用 Paper Aisle 导出的完整备份。");
  if (parsed.data.datasetId !== datasetId) throw new Error(`备份属于论文库“${parsed.data.datasetId}”，与当前论文库不一致；没有修改任何记录。`);
  if (Object.keys(parsed.data.state).some((key) => ["__proto__", "constructor", "prototype"].includes(key))) {
    throw new Error("备份包含无效的论文 ID。");
  }
  return parsed.data;
}

export function restoreConflicts(current: UserStateMap, incoming: UserStateMap): Array<{ paperId: string; fields: string[] }> {
  return Object.entries(incoming).flatMap(([paperId, record]) => {
    const existing = current[paperId];
    if (!existing) return [];
    const fields = (["favorite", "readingStatus", "note"] as const)
      .filter((key) => existing[key] !== undefined && record[key] !== undefined && existing[key] !== record[key]);
    return fields.length ? [{ paperId, fields }] : [];
  });
}

export function mergeBackup(current: UserStateMap, incoming: UserStateMap, preference: RestorePreference): UserStateMap {
  const merged: UserStateMap = { ...current };
  for (const [paperId, record] of Object.entries(incoming)) {
    const existing = current[paperId] ?? {};
    const preferred = preference === "current" ? existing : record;
    const secondary = preference === "current" ? record : existing;
    const next: PaperUserState = { ...secondary, ...preferred };
    const notes = [...new Set([existing.note, record.note].filter((note): note is string => Boolean(note?.trim())))];
    if (notes.length) {
      next.note = notes.length === 1 ? notes[0]
        : existing.note?.includes(`\n\n—— 备份中的便签 ——\n${record.note}`)
          ? existing.note : `${notes[0]}\n\n—— 备份中的便签 ——\n${notes[1]}`;
    }
    if (existing.tags || record.tags) next.tags = [...new Set([...(existing.tags ?? []), ...(record.tags ?? [])])];
    merged[paperId] = next;
  }
  return merged;
}

export function saveUserState(datasetId: string, state: UserStateMap): void {
  localStorage.setItem(storageKey(datasetId), JSON.stringify(state));
}

export function patchPaperState(
  current: UserStateMap,
  paperId: string,
  patch: Partial<PaperUserState>,
): UserStateMap {
  return {
    ...current,
    [paperId]: { ...current[paperId], ...patch },
  };
}
