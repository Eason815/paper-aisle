import { describe, expect, it } from "vitest";
import { SyncEngine } from "../src/cloud/SyncEngine";
import { cloudDatasetId, accountCacheKey, type CloudRecord, type CloudTransport } from "../src/cloud/model";

class Server implements CloudTransport {
  rows: Record<string, CloudRecord> = {};
  offline = false;
  loseReply = false;
  writes = 0;
  async list() { if (this.offline) throw new Error("offline"); return structuredClone(Object.values(this.rows)); }
  async write(paperId: string, data: CloudRecord["data"], expected: number) {
    if (this.offline) throw new Error("offline");
    const current = this.rows[paperId];
    if ((current?.revision ?? 0) !== expected) return { applied: false, record: structuredClone(current) };
    this.writes++;
    const record = { paperId, data: structuredClone(data), revision: expected + 1, updatedAt: new Date().toISOString() };
    this.rows[paperId] = record;
    if (this.loseReply) { this.loseReply = false; throw new Error("reply lost"); }
    return { applied: true, record: structuredClone(record) };
  }
}
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => { map.set(key, value); }, removeItem: key => { map.delete(key); }, clear: () => map.clear(), key: n => [...map.keys()][n] ?? null, get length() { return map.size; } };
}
const engine = (server: CloudTransport, storage = memoryStorage(), user = "owner") => new SyncEngine(user, "library", server, storage);

describe("account record synchronization", () => {
  it("isolates preview records without changing the production dataset identity", () => {
    expect(cloudDatasetId("library")).toBe("library");
    expect(cloudDatasetId("library", "preview")).toBe("library::preview");
    expect(accountCacheKey("owner", cloudDatasetId("library", "preview"))).not.toBe(accountCacheKey("owner", "library"));
    expect(() => cloudDatasetId("library", "invalid space")).toThrow();
  });

  it("persists offline edits across reload and syncs without duplicate rows", async () => {
    const server = new Server(); const storage = memoryStorage(); let device = engine(server, storage);
    server.offline = true;
    device.patch("paper", { note: "phone offline", readingStatus: "skimmed", favorite: true, tags: ["比较"] });
    await device.sync(); expect(device.snapshot().error).toBe("offline");
    device.dispose(); device = engine(server, storage);
    expect(device.snapshot().state.paper.note).toBe("phone offline");
    server.offline = false; await device.sync(); await device.sync();
    expect(device.snapshot().pending).toBe(0); expect(server.writes).toBe(1);
    const laptop = engine(server); await laptop.sync(); expect(laptop.snapshot().state).toEqual(device.snapshot().state);
  });
  it("detects two-device conflicts, retains both versions through reload, and applies explicit resolution", async () => {
    const server = new Server(); const storage = memoryStorage(); const a = engine(server); let b = engine(server, storage);
    a.patch("paper", { note: "base" }); await a.sync(); await b.sync();
    a.patch("paper", { note: "computer" }); b.patch("paper", { note: "phone" });
    await a.sync(); await b.sync();
    expect(server.rows.paper.data.note).toBe("computer");
    expect(b.snapshot().conflicts.paper.local.note).toBe("phone");
    b.dispose(); b = engine(server, storage);
    expect(b.snapshot().conflicts.paper.remote.data.note).toBe("computer");
    b.resolve("paper", { note: "computer + phone" }); await b.sync();
    expect(server.rows.paper.data.note).toBe("computer + phone"); expect(b.snapshot().pending).toBe(0);
  });
  it("does not let simultaneous first writes overwrite each other", async () => {
    const server = new Server(); const a = engine(server); const b = engine(server);
    a.patch("new", { note: "a" }); b.patch("new", { note: "b" });
    await Promise.all([a.sync(), b.sync()]);
    expect(server.writes).toBe(1);
    expect(Object.keys(a.snapshot().conflicts).length + Object.keys(b.snapshot().conflicts).length).toBe(1);
  });
  it("retains a newer edit made while its previous value is uploading", async () => {
    const server = new Server(); let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let sent!: () => void; const started = new Promise<void>(resolve => { sent = resolve; });
    const transport: CloudTransport = { list: () => server.list(), write: async (...args) => { const result = await server.write(...args); sent(); await gate; return result; } };
    const device = engine(transport); device.patch("p", { note: "first" });
    const uploading = device.sync(); await started; device.patch("p", { note: "newer" }); release(); await uploading;
    expect(device.snapshot().state.p.note).toBe("newer"); expect(device.snapshot().pending).toBe(1);
    await device.sync(); expect(server.rows.p.data.note).toBe("newer"); expect(device.snapshot().pending).toBe(0);
  });
  it("acknowledges a lost successful response without duplicating the write", async () => {
    const server = new Server(); server.loseReply = true;
    const device = engine(server); device.patch("p", { note: "retained" });
    await device.sync(); expect(device.snapshot().pending).toBe(1);
    await device.sync(); expect(device.snapshot().pending).toBe(0); expect(server.writes).toBe(1);
  });
  it("imports only on explicit confirmation, preserving notes and making repeated imports harmless", async () => {
    const server = new Server(); const device = engine(server); device.patch("p", { note: "cloud", readingStatus: "read" }); await device.sync();
    const legacy = { p: { note: "old", readingStatus: "skimmed" as const, tags: ["old"] } };
    expect(device.snapshot().legacyImported).toBe(false);
    device.importLegacy(legacy, "current"); const result = device.snapshot().state;
    device.importLegacy(legacy, "current"); expect(device.snapshot().state).toEqual(result);
    expect(result.p.note).toContain("old"); expect(result.p.note).toContain("cloud"); expect(result.p.readingStatus).toBe("read");
    await device.sync(); expect(device.snapshot().legacyImported).toBe(true);
  });
  it("isolates account caches and does not modify guest records", () => {
    const storage = memoryStorage(); storage.setItem("paper-aisle:library:user-state:v1", "guest");
    const a = engine(new Server(), storage); a.patch("p", { note: "owner private" });
    const b = engine(new Server(), storage, "second"); expect(b.snapshot().state).toEqual({});
    a.dispose(); a.clearCache(); expect(storage.getItem(accountCacheKey("owner", "library"))).toBeNull();
    expect(storage.getItem("paper-aisle:library:user-state:v1")).toBe("guest");
  });
  it("never overwrites corrupted caches, and reports storage failure without claiming saved", () => {
    const storage = memoryStorage(); const key = accountCacheKey("owner", "library"); storage.setItem(key, "broken");
    expect(() => engine(new Server(), storage)).toThrow(); expect(storage.getItem(key)).toBe("broken");
    storage.clear(); const device = engine(new Server(), storage); storage.setItem = () => { throw new Error("quota"); };
    device.patch("p", { note: "can still export" }); expect(device.snapshot().localSaved).toBe(false); expect(device.snapshot().state.p.note).toBe("can still export");
  });
  it("ignores in-flight responses after sign-out disposal", async () => {
    let release!: (rows: CloudRecord[]) => void;
    const list = new Promise<CloudRecord[]>(resolve => { release = resolve; });
    const storage = memoryStorage(); const device = engine({ list: () => list, write: async () => { throw new Error("unexpected write"); } }, storage);
    const pending = device.sync(); device.dispose(); device.clearCache(); release([{ paperId: "p", data: { note: "private" }, revision: 1, updatedAt: "now" }]); await pending;
    expect(storage.getItem(device.key)).toBeNull();
  });
});
