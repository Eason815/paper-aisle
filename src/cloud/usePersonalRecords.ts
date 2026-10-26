import { useCallback, useEffect, useRef, useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import type { UserStateMap } from "../types";
import { loadUserState, mergeBackup, type RestorePreference } from "../storage";
import { cloudClient, cloudConfigIssue, transportFor } from "./client";
import { SyncEngine } from "./SyncEngine";
import { cleanRecord, type Snapshot } from "./model";

const emptySnapshot: Snapshot = { state: {}, pending: 0, conflicts: {}, syncing: false, error: "", localSaved: true, lastSyncedAt: null, legacyImported: false, initialFetchComplete: false };
function protectedKey(dataset: string) { return `paper-aisle:${dataset}:legacy-private`; }
function guestKey(dataset: string) { return `paper-aisle:${dataset}:guest-state:v1`; }
function legacyRecords(dataset: string) { return loadUserState(dataset, dataset === "paper-aisle-main-v1" ? ["paper-aisle-demo-v1"] : []); }
function loadGuest(dataset: string): UserStateMap {
  return localStorage.getItem(protectedKey(dataset)) ? JSON.parse(localStorage.getItem(guestKey(dataset)) ?? "{}") : legacyRecords(dataset);
}
function saveGuest(dataset: string, state: UserStateMap) {
  const key = localStorage.getItem(protectedKey(dataset)) ? guestKey(dataset) : `paper-aisle:${dataset}:user-state:v1`;
  localStorage.setItem(key, JSON.stringify(state));
}

export function usePersonalRecords(datasetId: string | undefined, client: SupabaseClient | null = cloudClient) {
  const [state, setState] = useState<UserStateMap>({});
  const stateRef = useRef(state);
  const [session, setSession] = useState<Session | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [authError, setAuthError] = useState(cloudConfigIssue);
  const [authBusy, setAuthBusy] = useState(Boolean(client));
  const [saved, setSaved] = useState(true);
  const engineRef = useRef<SyncEngine | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const [legacy, setLegacy] = useState<UserStateMap>({});
  const epoch = useRef(0);
  const alive = useRef(true);
  const publish = useCallback((next: UserStateMap) => { stateRef.current = next; setState(next); }, []);

  useEffect(() => {
    alive.current = true;
    if (!datasetId) return;
    let active = true;
    let unsubscribeEngine: (() => void) | undefined;
    const showGuest = () => {
      try { publish(loadGuest(datasetId)); setSaved(true); }
      catch { publish({}); setSaved(false); setAuthError("无法读取本机记录，请保留原备份后再尝试。"); }
    };
    showGuest();
    if (!client) { setAuthBusy(false); return; }
    const activate = async (next: Session | null) => {
      if (!alive.current || !active) return;
      if (next?.user.id === engineRef.current?.userId) {
        sessionRef.current = next; setSession(next); setAuthBusy(false); return;
      }
      const sequence = ++epoch.current;
      unsubscribeEngine?.(); engineRef.current?.dispose(); engineRef.current = null;
      sessionRef.current = next; setSession(next); setSnapshot(emptySnapshot); setAuthError("");
      if (!next) { showGuest(); setAuthBusy(false); return; }
      publish({}); setAuthBusy(true);
      try {
        // Protect old guest records from being shown after sign-out; leave their original storage intact.
        const original = legacyRecords(datasetId);
        const guest = JSON.parse(localStorage.getItem(guestKey(datasetId)) ?? "{}") as UserStateMap;
        const migratable = mergeBackup(original, guest, "current");
        localStorage.setItem(protectedKey(datasetId), "true");
        if (!alive.current || !active || sequence !== epoch.current) return;
        const engine = new SyncEngine(next.user.id, datasetId, transportFor(client, next.user.id, datasetId), localStorage);
        engineRef.current = engine;
        setLegacy(migratable);
        const refresh = () => {
          if (!alive.current || engine !== engineRef.current) return;
          const view = engine.snapshot(); setSnapshot(view); publish(view.state); setSaved(view.localSaved);
        };
        unsubscribeEngine = engine.subscribe(refresh); refresh();
        void engine.sync();
      } catch (error) {
        if (alive.current && sequence === epoch.current) setAuthError(error instanceof Error ? error.message : "无法加载云端账号。");
      } finally { if (alive.current && sequence === epoch.current) setAuthBusy(false); }
    };
    // Defer Auth callbacks: never await other Supabase calls while Auth's callback holds its lock.
    const initialEpoch = epoch.current;
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, next) => { queueMicrotask(() => { if (alive.current && active) void activate(next); }); });
    void client.auth.getSession().then(({ data, error }) => {
      if (!alive.current || !active) return;
      if (epoch.current !== initialEpoch) return;
      if (error) { setAuthError("登录已失效，请重新登录。"); setAuthBusy(false); }
      else void activate(data.session);
    });
    return () => { active = false; alive.current = false; ++epoch.current; subscription.unsubscribe(); unsubscribeEngine?.(); engineRef.current?.dispose(); engineRef.current = null; };
  }, [datasetId, client, publish]);

  const syncNow = useCallback(async () => { await engineRef.current?.sync(); }, []);
  useEffect(() => {
    if (!session) return;
    const sync = () => { if (document.visibilityState !== "hidden" && navigator.onLine) void syncNow(); };
    window.addEventListener("focus", sync); window.addEventListener("online", sync); document.addEventListener("visibilitychange", sync);
    const interval = window.setInterval(sync, 30000);
    return () => { window.removeEventListener("focus", sync); window.removeEventListener("online", sync); document.removeEventListener("visibilitychange", sync); clearInterval(interval); };
  }, [session?.user.id, syncNow]);
  useEffect(() => {
    if (!snapshot.pending || snapshot.syncing || !session || snapshot.pending <= Object.keys(snapshot.conflicts).length) return;
    const timer = window.setTimeout(() => { if (navigator.onLine) void syncNow(); }, snapshot.error ? 10000 : 1000);
    return () => clearTimeout(timer);
  }, [snapshot, session, syncNow]);

  const update = useCallback((transform: (current: UserStateMap) => UserStateMap) => {
    if (!datasetId) return;
    const next = transform(stateRef.current);
    Object.values(next).forEach(cleanRecord);
    if (sessionRef.current) {
      if (!engineRef.current) throw new Error("账号尚未就绪，请先打开账号面板处理。");
      engineRef.current.replace(next);
    } else {
      publish(next);
      try { saveGuest(datasetId, next); setSaved(true); }
      catch { setSaved(false); setAuthError("未保存本机，请导出备份。"); }
    }
  }, [datasetId, publish]);
  const flush = useCallback(() => {
    if (!datasetId || sessionRef.current) return;
    try { saveGuest(datasetId, stateRef.current); setSaved(true); }
    catch { setSaved(false); setAuthError("未保存本机，请导出备份。"); }
  }, [datasetId]);
  useEffect(() => { window.addEventListener("pagehide", flush); return () => window.removeEventListener("pagehide", flush); }, [flush]);
  const signIn = async (email: string, password: string) => {
    if (!client) return;
    setAuthError("");
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw new Error("登录失败，请检查邮箱、密码和网络。忘记密码请通过管理端恢复。");
  };
  const signOut = async () => {
    const engine = engineRef.current;
    engine?.dispose();
    const { error } = await client!.auth.signOut({ scope: "local" });
    if (error) { window.location.reload(); throw new Error("退出未完成，请重试；本机记录仍保留。"); }
    engine?.clearCache();
  };
  const importLegacy = (preference: RestorePreference) => {
    engineRef.current?.importLegacy(legacy, preference);
  };
  const resolve = (id: string, data: Parameters<SyncEngine["resolve"]>[1]) => engineRef.current?.resolve(id, data);
  const syncLabel = !saved ? "需要处理" : authError || snapshot.error || Object.keys(snapshot.conflicts).length ? "需要处理"
    : snapshot.syncing ? "同步中" : session && snapshot.initialFetchComplete && snapshot.pending === 0 ? "已同步" : "已保存本机";
  return { state, update, flush, saved, saveError: saved ? "" : "未保存，请导出备份", enabled: Boolean(client), session,
    snapshot, authError, authBusy, legacy, syncLabel, syncNow, signIn, signOut, importLegacy, resolve };
}
