import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { usePersonalRecords } from "../src/cloud/usePersonalRecords";
import { transportFor } from "../src/cloud/client";
import { AccountDialog } from "../src/AccountDialog";
import { accountCacheKey, type CloudRecord, type CloudTransport } from "../src/cloud/model";
import { storageKey } from "../src/storage";
import { parseDataset } from "../src/types";
import library from "../public/data/papers.json";

vi.mock("../src/cloud/client", () => ({ cloudClient: null, cloudConfigIssue: "", transportFor: vi.fn() }));
vi.mock("../src/export", async importOriginal => ({ ...await importOriginal<typeof import("../src/export")>(), downloadText: vi.fn() }));
const dataset = parseDataset(library).dataset;
const session = { access_token: "synthetic-access", refresh_token: "synthetic-refresh", token_type: "bearer", expires_in: 3600,
  user: { id: "owner", email: "reader@example.test", app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-10-26T00:00:00Z" } } as Session;
function authClient(restored: Session | null = session) {
  const listeners = new Set<(event: string, session: Session | null) => void>();
  let current = restored;
  const auth = {
    getSession: vi.fn(async () => ({ data: { session: current }, error: null })),
    onAuthStateChange: vi.fn((listener: (event: string, session: Session | null) => void) => { listeners.add(listener); return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } }; }),
    signInWithPassword: vi.fn(async () => { current = session; listeners.forEach(fn => fn("SIGNED_IN", current)); return { data: { session }, error: null }; }),
    signOut: vi.fn(async () => { current = null; listeners.forEach(fn => fn("SIGNED_OUT", null)); return { error: null }; }),
  };
  return { client: { auth } as unknown as SupabaseClient, auth };
}
let server: CloudTransport;
let rows: Record<string, CloudRecord>;
let writes: number;
let offline: boolean;
beforeEach(() => {
  rows = {}; writes = 0; offline = false;
  server = {
    list: async () => { if (offline) throw new Error("offline"); return structuredClone(Object.values(rows)); },
    write: async (paperId, data, expected) => {
      if (offline) throw new Error("offline");
      if ((rows[paperId]?.revision ?? 0) !== expected) return { applied: false, record: rows[paperId] };
      writes++; const record = { paperId, data: structuredClone(data), revision: expected + 1, updatedAt: new Date().toISOString() }; rows[paperId] = record;
      return { applied: true, record };
    },
  };
  vi.mocked(transportFor).mockReturnValue(server);
});

describe("account lifecycle and migration UI", () => {
  it("restores a session without credentials, waits for migration consent, and hides private records after logout", async () => {
    const old = { p: { note: "old local private", readingStatus: "skimmed" } };
    localStorage.setItem(storageKey(dataset.datasetId), JSON.stringify(old));
    const { client, auth } = authClient();
    const { result } = renderHook(() => usePersonalRecords(dataset.datasetId, client));
    await waitFor(() => expect(result.current.snapshot.initialFetchComplete).toBe(true));
    expect(auth.signInWithPassword).not.toHaveBeenCalled(); expect(result.current.state).toEqual({}); expect(writes).toBe(0);
    expect(result.current.legacy).toEqual(old);
    act(() => result.current.importLegacy("current"));
    await act(() => result.current.syncNow()); expect(rows.p.data.note).toBe("old local private");
    await act(() => result.current.signOut());
    await waitFor(() => expect(result.current.session).toBeNull());
    expect(result.current.state).toEqual({});
    expect(localStorage.getItem(accountCacheKey("owner", dataset.datasetId))).toBeNull();
    expect(JSON.parse(localStorage.getItem(storageKey(dataset.datasetId))!)).toEqual(old);
  });
  it("can resume the signed-in account cache and edit after reloading offline", async () => {
    const { client } = authClient();
    const first = renderHook(() => usePersonalRecords(dataset.datasetId, client));
    await waitFor(() => expect(first.result.current.snapshot.initialFetchComplete).toBe(true));
    act(() => first.result.current.update(() => ({ p: { note: "pending phone note" } })));
    first.unmount(); offline = true;
    const second = renderHook(() => usePersonalRecords(dataset.datasetId, client));
    await waitFor(() => expect(second.result.current.state.p?.note).toBe("pending phone note"));
    act(() => second.result.current.update(current => ({ ...current, p: { note: "offline update" } })));
    expect(second.result.current.state.p.note).toBe("offline update");
    offline = false; await act(() => second.result.current.syncNow());
    expect(rows.p.data.note).toBe("offline update");
  });
  it("requires preview and confirmation before merging old records", async () => {
    localStorage.setItem(storageKey(dataset.datasetId), JSON.stringify({ p: { note: "legacy" } }));
    const { client } = authClient(); let api!: ReturnType<typeof usePersonalRecords>;
    function Harness() { api = usePersonalRecords(dataset.datasetId, client); return <AccountDialog open onOpenChange={() => undefined} records={api} dataset={dataset} />; }
    const user = userEvent.setup(); render(<Harness />);
    const preview = await screen.findByRole("button", { name: "预览旧记录迁移" });
    await waitFor(() => expect(preview).toBeEnabled());
    await user.click(preview); expect(writes).toBe(0);
    expect(screen.getByRole("button", { name: "确认合并到账号" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认合并到账号" }));
    await act(() => api.syncNow()); expect(rows.p.data.note).toBe("legacy");
  });
  it("shows a pending-change exit guard and never signs out from the first exit click", async () => {
    const { client, auth } = authClient(); let api!: ReturnType<typeof usePersonalRecords>;
    function Harness() { api = usePersonalRecords(dataset.datasetId, client); return <AccountDialog open onOpenChange={() => undefined} records={api} dataset={dataset} />; }
    const user = userEvent.setup(); render(<Harness />);
    await waitFor(() => expect(api.snapshot.initialFetchComplete).toBe(true));
    offline = true; act(() => api.update(() => ({ p: { note: "unsent" } })));
    await user.click(screen.getByRole("button", { name: "退出此设备" }));
    expect(screen.getByRole("heading", { name: "还有未上传的修改" })).toBeInTheDocument(); expect(auth.signOut).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "继续阅读" })); expect(api.state.p.note).toBe("unsent");
  });
  it("uses the same local-first writer when changing records through the signed-in UI", async () => {
    const { client, auth } = authClient(null); let api!: ReturnType<typeof usePersonalRecords>;
    function Harness() { api = usePersonalRecords(dataset.datasetId, client); return <AccountDialog open onOpenChange={() => undefined} records={api} dataset={dataset} />; }
    const user = userEvent.setup(); render(<Harness />);
    const dialog = screen.getByRole("dialog", { name: "账号与同步" });
    await user.type(within(dialog).getByLabelText("邮箱"), "reader@example.test");
    await user.type(within(dialog).getByLabelText("密码"), "synthetic-password");
    await user.click(within(dialog).getByRole("button", { name: "登录并同步" }));
    await waitFor(() => expect(api.snapshot.initialFetchComplete).toBe(true));
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: "reader@example.test", password: "synthetic-password" });
    act(() => api.update(() => ({ p: { favorite: true, readingStatus: "skimmed", note: "from UI", tags: ["compare"] } })));
    expect(JSON.stringify(localStorage)).not.toContain("synthetic-password");
    expect(JSON.parse(localStorage.getItem(accountCacheKey("owner", dataset.datasetId))!).entries.p.data.note).toBe("from UI");
    await act(() => api.syncNow()); expect(rows.p.data.readingStatus).toBe("skimmed");
  });
});
