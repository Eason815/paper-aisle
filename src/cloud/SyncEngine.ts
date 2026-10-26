import type { PaperUserState, UserStateMap } from "../types";
import { mergeBackup, type RestorePreference } from "../storage";
import { accountCacheKey, cleanRecord, parseCache, sameRecord, type Cache, type CloudRecord, type CloudTransport, type Snapshot } from "./model";

export class SyncEngine {
  private cache: Cache;
  private listeners = new Set<() => void>();
  private syncing = false;
  private error = "";
  private localSaved = true;
  private initialFetchComplete = false;
  private lastSyncedAt: string | null = null;
  private disposed = false;
  private inFlight: Promise<void> | null = null;
  readonly key: string;
  constructor(readonly userId: string, readonly datasetId: string, private transport: CloudTransport, private storage: Storage) {
    this.key = accountCacheKey(userId, datasetId);
    // Broken cache must never be replaced with an empty state automatically.
    this.cache = parseCache(storage.getItem(this.key));
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot(): Snapshot {
    return {
      state: Object.fromEntries(Object.entries(this.cache.entries).map(([id, entry]) => [id, entry.data])),
      pending: Object.values(this.cache.entries).filter(e => e.dirty).length,
      conflicts: Object.fromEntries(Object.entries(this.cache.entries).filter(([, e]) => e.conflict).map(([id, e]) => [id, { local: e.data, remote: e.conflict! }])),
      syncing: this.syncing, error: this.error, localSaved: this.localSaved,
      lastSyncedAt: this.lastSyncedAt, legacyImported: this.cache.legacyImported, initialFetchComplete: this.initialFetchComplete,
    };
  }
  private emit() { if (!this.disposed) this.listeners.forEach(fn => fn()); }
  private persist() {
    try { this.storage.setItem(this.key, JSON.stringify(this.cache)); this.localSaved = true; }
    catch { this.localSaved = false; this.error = "未能保存本机，请先导出备份。"; }
    this.emit();
  }
  patch(id: string, patch: Partial<PaperUserState>) {
    if (this.disposed) return;
    if (!id || ["__proto__", "constructor", "prototype"].includes(id)) throw new Error("论文ID无效");
    const previous = this.cache.entries[id];
    const data = cleanRecord({ ...previous?.data, ...patch });
    if (previous && sameRecord(previous.data, data)) return;
    this.cache.entries[id] = { ...previous, data, revision: previous?.revision ?? 0, dirty: true, generation: (previous?.generation ?? 0) + 1 };
    this.persist();
  }
  replace(state: UserStateMap) {
    // Restore only modifies provided records; absent records are retained.
    Object.entries(state).forEach(([id, data]) => this.patch(id, data));
  }
  importLegacy(state: UserStateMap, preference: RestorePreference) {
    if (!this.initialFetchComplete) throw new Error("请先连接云端，再预览迁移。");
    this.replace(mergeBackup(this.snapshot().state, state, preference));
    this.cache.legacyImported = true;
    this.persist();
  }
  resolve(id: string, data: PaperUserState) {
    const entry = this.cache.entries[id];
    if (!entry?.conflict) return;
    const remote = entry.conflict;
    const chosen = cleanRecord(data);
    this.cache.entries[id] = { data: chosen, revision: remote.revision, dirty: !sameRecord(chosen, remote.data), generation: entry.generation + 1 };
    this.persist();
  }
  private receive(remote: CloudRecord) {
    const current = this.cache.entries[remote.paperId];
    if (!current?.dirty || sameRecord(current.data, remote.data)) {
      this.cache.entries[remote.paperId] = { data: cleanRecord(remote.data), revision: remote.revision, dirty: false, generation: current?.generation ?? 0 };
    } else if (current.revision !== remote.revision) current.conflict = remote;
  }
  sync(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (this.disposed) return Promise.resolve();
    this.inFlight = this.run().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }
  private async run() {
    this.syncing = true; this.error = ""; this.emit();
    try {
      const rows = await this.transport.list();
      if (this.disposed) return;
      rows.forEach(row => this.receive(row));
      this.initialFetchComplete = true;
      this.persist();
      for (const id of Object.keys(this.cache.entries)) {
        const entry = this.cache.entries[id];
        if (this.disposed) return;
        if (!entry.dirty || entry.conflict) continue;
        const sent = { data: structuredClone(entry.data), revision: entry.revision, generation: entry.generation };
        const result = await this.transport.write(id, sent.data, sent.revision);
        if (this.disposed) return;
        const current = this.cache.entries[id];
        if (result.applied) {
          current.revision = result.record.revision;
          if (current.generation === sent.generation) { current.data = result.record.data; current.dirty = false; delete current.conflict; }
          // Edits made during an upload retain their value and queue against the new server revision.
        } else this.receive(result.record);
        this.persist();
      }
      this.lastSyncedAt = new Date().toISOString();
    } catch (error) {
      if (!this.disposed) this.error = error instanceof Error ? error.message : "同步失败，请稍后重试。";
    } finally { this.syncing = false; if (!this.disposed) this.persist(); }
  }
  dispose() { this.disposed = true; this.listeners.clear(); }
  clearCache() { this.storage.removeItem(this.key); }
}
