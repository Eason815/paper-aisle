import * as Dialog from "@radix-ui/react-dialog";
import { Cloud, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createBackup, mergeBackup, restoreConflicts, type RestorePreference } from "./storage";
import { downloadText } from "./export";
import type { Dataset, PaperUserState } from "./types";
import type { usePersonalRecords } from "./cloud/usePersonalRecords";
import { readingLabels } from "./utils";

type Records = ReturnType<typeof usePersonalRecords>;
function RecordPreview({ data }: { data: PaperUserState }) {
  return <dl className="record-preview"><dt>阅读状态</dt><dd>{readingLabels[data.readingStatus ?? "unread"]}</dd><dt>收藏</dt><dd>{data.favorite ? "已收藏" : "未收藏"}</dd><dt>标签</dt><dd>{data.tags?.join("、") || "无"}</dd><dt>便签</dt><dd className="note-preview">{data.note || "（空）"}</dd></dl>;
}
function ConflictEditor({ id, title, records }: { id: string; title: string; records: Records }) {
  const conflict = records.snapshot.conflicts[id];
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState(false);
  const [base, setBase] = useState<"local" | "remote">("local");
  if (!conflict) return null;
  return <section className="sync-conflict"><h3>{title}</h3><p>两台设备修改了同一篇论文。两份记录均保留，请选择处理。</p>
    <div className="conflict-columns"><div><h4>本机待上传</h4><RecordPreview data={conflict.local} /></div><div><h4>云端版本</h4><RecordPreview data={conflict.remote.data} /></div></div>
    <div className="account-actions"><button className="button outline" onClick={() => records.resolve(id, conflict.local)}>保留本机版本</button><button className="button outline" onClick={() => records.resolve(id, conflict.remote.data)}>采用云端版本</button>
    <button className="button outline" onClick={() => { setNote([conflict.local.note, conflict.remote.data.note].filter(Boolean).join("\n\n—— 另一版本 ——\n")); setEditing(true); }}>编辑合并内容</button></div>
    {editing && <div><label>其他字段采用<select aria-label="合并时其他字段采用" value={base} onChange={e => setBase(e.target.value as "local" | "remote")}><option value="local">本机版本</option><option value="remote">云端版本</option></select></label><label>合并便签<textarea aria-label="合并便签" value={note} onChange={e => setNote(e.target.value)} /></label><button className="button dark" onClick={() => records.resolve(id, { ...(base === "local" ? conflict.local : conflict.remote.data), note })}>保存合并结果</button></div>}
  </section>;
}
export function AccountDialog({ open, onOpenChange, records, dataset }: { open: boolean; onOpenChange: (value: boolean) => void; records: Records; dataset: Dataset }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [migrationPreview, setMigrationPreview] = useState(false);
  const [preference, setPreference] = useState<RestorePreference>("current");
  const [logoutPreview, setLogoutPreview] = useState(false);
  const conflicts = Object.keys(records.snapshot.conflicts);
  useEffect(() => { if (records.snapshot.pending === 0 && records.saved) setLogoutPreview(false); }, [records.snapshot.pending, records.saved]);
  const migrateCount = Object.keys(records.legacy).length;
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : "操作未完成，请重试。"); }
    finally { setBusy(false); }
  };
  const exportBackup = () => {
    downloadText(`paper-aisle-records-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(createBackup(dataset.datasetId, records.state), null, 2), "application/json;charset=utf-8");
  };
  const logout = async () => { await records.signOut(); setLogoutPreview(false); setMigrationPreview(false); onOpenChange(false); };
  return <Dialog.Root open={open} onOpenChange={next => { setPassword(""); onOpenChange(next); }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content account-dialog">
    <div className="dialog-topbar"><div><Dialog.Title>账号与同步</Dialog.Title><Dialog.Description>在手机和电脑之间继续阅读</Dialog.Description></div><Dialog.Close className="dialog-close" aria-label="关闭"><X size={20} /></Dialog.Close></div>
    <div className="modal-body">
    {!records.session ? <form onSubmit={event => { event.preventDefault(); void run(async () => { try { await records.signIn(email.trim(), password); } finally { setPassword(""); } }); }}>
      <p>仅限已配置的个人账号。首次登录后保持登录，日常打开网站即可同步。</p>
      <label>邮箱<input name="email" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></label>
      <label>密码<input name="password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
      <button className="button dark" disabled={busy || records.authBusy}>{busy || records.authBusy ? "正在连接…" : "登录并同步"}</button><p>不开放注册。忘记密码请通过 Supabase 管理端恢复。</p>
    </form> : <>
      <p>已登录：{records.session.user.email}</p><p className="sync-summary" role="status"><Cloud size={18} />{records.syncLabel} · 待同步 {records.snapshot.pending} 篇</p>
      {records.snapshot.lastSyncedAt && <p>最近同步：{new Date(records.snapshot.lastSyncedAt).toLocaleString("zh-CN")}</p>}
      <div className="account-actions"><button className="button dark" disabled={busy || records.authBusy || records.snapshot.syncing} onClick={() => void run(records.syncNow)}>立即同步</button><button className="button outline" onClick={exportBackup}>导出完整备份</button><button className="button outline" disabled={busy} onClick={() => { if (records.snapshot.pending > 0 || !records.saved) setLogoutPreview(true); else void run(logout); }}>退出此设备</button></div>
      {logoutPreview && <section className="records-section"><h3>还有未上传的修改</h3><p>退出会清除此账号在本机的缓存。请先同步，或导出备份再退出；云端记录不会删除。</p><div className="account-actions"><button className="button dark" disabled={busy} onClick={() => void run(records.syncNow)}>先同步</button><button className="button outline" disabled={busy} onClick={() => void run(async () => { exportBackup(); await logout(); })}>导出备份并退出</button><button className="button outline" onClick={() => setLogoutPreview(false)}>继续阅读</button></div></section>}
      {migrateCount > 0 && !records.snapshot.legacyImported && <section className="records-section"><h3>发现本机旧阅读记录</h3><p>共有 {migrateCount} 篇。确认后才会合并到此账号；原始本地记录保留。</p><button className="button outline" disabled={!records.snapshot.initialFetchComplete || records.snapshot.syncing} onClick={() => setMigrationPreview(!migrationPreview)}>预览旧记录迁移</button>
      {migrationPreview && <div className="migration-preview"><p>本机旧记录 {migrateCount} 篇，当前账号 {Object.keys(records.state).length} 篇，字段差异 {restoreConflicts(records.state, records.legacy).length} 篇。</p><fieldset><legend>收藏和阅读状态不同的处理方式</legend><label><input type="radio" name="migration-preference" checked={preference === "current"} onChange={() => setPreference("current")} />优先保留账号记录</label><label><input type="radio" name="migration-preference" checked={preference === "backup"} onChange={() => setPreference("backup")} />优先采用本机旧记录</label></fieldset><p>标签取并集，不同便签并列保留。</p>
      <details><summary>查看待迁移内容</summary>{Object.entries(records.legacy).map(([id, data]) => <section key={id}><h4>{dataset.papers.find(p => p.id === id)?.title ?? id}</h4><RecordPreview data={data} /></section>)}</details>
      <details><summary>查看合并后结果</summary>{Object.entries(mergeBackup(records.state, records.legacy, preference)).map(([id, data]) => <section key={id}><h4>{dataset.papers.find(p => p.id === id)?.title ?? id}</h4><RecordPreview data={data} /></section>)}</details>
      <button className="button dark" onClick={() => { records.importLegacy(preference); setMigrationPreview(false); }}>确认合并到账号</button><button className="button outline" onClick={() => setMigrationPreview(false)}>暂不迁移</button></div>}</section>}
      {conflicts.map(id => <ConflictEditor key={id} id={id} title={dataset.papers.find(p => p.id === id)?.title ?? id} records={records} />)}
    </>}
    {(error || records.authError || records.snapshot.error) && <p className="records-error" role="alert">{error || records.authError || records.snapshot.error}</p>}
    <p className="mobile-reading-tip">手机可在浏览器菜单中选择“添加到主屏幕”。请固定使用同一浏览器和正式网址；短暂断网时先保存本机，联网后补传。</p>
    </div>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
