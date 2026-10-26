import { z } from "zod";
import type { PaperUserState, UserStateMap } from "../types";
import { personalStateSchema as recordSchema } from "../storage";

export { recordSchema };

export type CloudRecord = { paperId: string; data: PaperUserState; revision: number; updatedAt: string };
export type Conflict = { local: PaperUserState; remote: CloudRecord };
export type Entry = { data: PaperUserState; revision: number; dirty: boolean; generation: number; conflict?: CloudRecord };
export type Cache = { version: 1; entries: Record<string, Entry>; legacyImported: boolean };
export type Snapshot = {
  state: UserStateMap; pending: number; conflicts: Record<string, Conflict>;
  syncing: boolean; error: string; localSaved: boolean; lastSyncedAt: string | null;
  legacyImported: boolean; initialFetchComplete: boolean;
};
export interface CloudTransport {
  list(): Promise<CloudRecord[]>;
  write(paperId: string, data: PaperUserState, expectedRevision: number): Promise<{ applied: boolean; record: CloudRecord }>;
}

export function cleanRecord(value: unknown): PaperUserState { return recordSchema.parse(value); }
export function sameRecord(a: PaperUserState, b: PaperUserState): boolean {
  return a.favorite === b.favorite && a.favoritedAt === b.favoritedAt
    && a.readingStatus === b.readingStatus && a.note === b.note
    && JSON.stringify(a.tags ?? []) === JSON.stringify(b.tags ?? []);
}
export function accountCacheKey(userId: string, datasetId: string) {
  return `paper-aisle:cloud:v1:${encodeURIComponent(userId)}:${encodeURIComponent(datasetId)}`;
}

const remoteSchema = z.object({
  paperId: z.string().min(1), data: recordSchema, revision: z.number().int().nonnegative(), updatedAt: z.string(),
});
const cacheSchema = z.object({
  version: z.literal(1), legacyImported: z.boolean(),
  entries: z.record(z.object({
    data: recordSchema, revision: z.number().int().nonnegative(), dirty: z.boolean(),
    generation: z.number().int().nonnegative(), conflict: remoteSchema.optional(),
  })),
});
export function parseCache(raw: string | null): Cache {
  if (!raw) return { version: 1, entries: {}, legacyImported: false };
  const cache = cacheSchema.parse(JSON.parse(raw));
  if (Object.keys(cache.entries).some(id => ["__proto__", "constructor", "prototype"].includes(id))) throw new Error("缓存含无效论文ID");
  return cache;
}
