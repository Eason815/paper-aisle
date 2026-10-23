import * as Dialog from "@radix-ui/react-dialog";
import { Download, FileUp, ShieldCheck, X } from "lucide-react";
import { useRef, useState } from "react";
import { downloadText, markdownFor } from "./export";
import { createBackup, mergeBackup, parseBackup, restoreConflicts, type RestorePreference, type UserStateBackup } from "./storage";
import type { Dataset, Paper, UserStateMap } from "./types";

const conflictLabels: Record<string, string> = { favorite: "收藏", readingStatus: "阅读状态", note: "便签" };

export function PersonalRecordsDialog({ open, onOpenChange, dataset, scopePapers, scopeName, state, onRestore }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dataset: Dataset;
  scopePapers: Paper[];
  scopeName: string;
  state: UserStateMap;
  onRestore: (next: UserStateMap) => void;
}) {
  const [backup, setBackup] = useState<UserStateBackup | null>(null);
  const [preference, setPreference] = useState<RestorePreference>("current");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const conflicts = backup ? restoreConflicts(state, backup.state) : [];
  const knownIds = new Set(dataset.papers.map((paper) => paper.id));
  const unknownCount = backup ? Object.keys(backup.state).filter((id) => !knownIds.has(id)).length : 0;
  const handledStateCount = Object.keys(state).length;
  const exportBackup = () => {
    try {
      const content = createBackup(dataset.datasetId, state);
      downloadText(`paper-aisle-records-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(content, null, 2), "application/json;charset=utf-8");
      setFeedback("完整备份已导出，包含所有论文的个人状态与便签。");
    } catch { setError("当前记录无法导出，请保留浏览器页面并检查记录格式。"); }
  };
  const readFile = async (file?: File) => {
    setError(""); setFeedback(""); setBackup(null); setPreference("current");
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setError("备份文件超过 10 MB，尚未导入。"); return; }
    try { setBackup(parseBackup(await file.text(), dataset.datasetId)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "无法读取备份文件。"); }
  };
  const restore = () => {
    if (!backup) return;
    try {
      onRestore(mergeBackup(state, backup.state, preference));
      setFeedback(`已恢复 ${Object.keys(backup.state).length} 篇记录；不同便签和标签均已保留。`);
      setBackup(null);
    } catch { setError("浏览器未能保存恢复结果，原有记录未替换。请先导出备份，并检查浏览器存储空间。"); }
  };
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content personal-records-dialog" onOpenAutoFocus={() => { openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }} onCloseAutoFocus={(event) => { event.preventDefault(); if (openerRef.current?.isConnected) openerRef.current.focus(); }}>
          <div className="dialog-topbar"><div><Dialog.Title>个人阅读记录</Dialog.Title><Dialog.Description>备份、恢复，以及导出当前阅读范围</Dialog.Description></div><Dialog.Close className="dialog-close" aria-label="关闭"><X size={20} /></Dialog.Close></div>
          <div className="modal-body">
            <div className="records-intro"><ShieldCheck size={24} aria-hidden="true" /><div><h3>把自己的理解留好</h3><p>当前有 {handledStateCount} 篇论文的个人记录。记录保存在这个浏览器里；备份可带到同一论文库的其他设备，不会上传到服务器。</p></div></div>
            <section className="records-section"><h3>完整备份</h3><p>包含所有论文的收藏、收藏时间、阅读状态、标签与便签，包括暂时不在当前论文库列表里的记录。</p><button className="button dark" onClick={exportBackup}><Download size={16} />导出全部记录 JSON</button></section>
            <section className="records-section"><h3>导出本轮阅读记录</h3><p>范围：{scopeName} · {scopePapers.length} 篇。包含稳定论文 ID、原文链接和个人笔记，方便交给 AI 整理。</p><button className="button outline" disabled={!scopePapers.length} onClick={() => downloadText("paper-aisle-reading-notes.md", markdownFor(scopePapers, state, dataset.library.name, scopeName), "text/markdown;charset=utf-8")}><Download size={16} />导出阅读 Markdown</button></section>
            <section className="records-section"><h3>从备份恢复</h3><p>选择文件后先预览。不同便签会并列保留，标签取并集；收藏和阅读状态可选择优先使用哪一份。</p>
              <input className="sr-only" type="file" accept=".json,application/json" ref={fileRef} aria-label="选择个人记录备份" onChange={(event) => { void readFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
              <button className="button outline" onClick={() => fileRef.current?.click()}><FileUp size={16} />选择备份文件</button>
              {backup && <div className="restore-preview"><h4>恢复预览</h4><dl><div><dt>备份时间</dt><dd>{new Date(backup.exportedAt).toLocaleString("zh-CN")}</dd></div><div><dt>记录数量</dt><dd>{Object.keys(backup.state).length} 篇</dd></div><div><dt>存在差异</dt><dd>{conflicts.length} 篇</dd></div></dl>
                {unknownCount > 0 && <p>{unknownCount} 篇暂不在当前论文列表中，恢复后仍会保留，供后续数据更新时关联。</p>}
                {conflicts.length > 0 && <><fieldset><legend>收藏和阅读状态发生差异时</legend><label><input type="radio" name="restore-preference" checked={preference === "current"} onChange={() => setPreference("current")} />优先保留当前状态，便签合并</label><label><input type="radio" name="restore-preference" checked={preference === "backup"} onChange={() => setPreference("backup")} />优先采用备份状态，便签合并</label></fieldset><details><summary>查看 {conflicts.length} 篇差异</summary>{conflicts.map((conflict) => <div className="restore-conflict" key={conflict.paperId}><strong>{dataset.papers.find((p) => p.id === conflict.paperId)?.title ?? conflict.paperId}</strong><small>{conflict.fields.map((field) => conflictLabels[field]).join("、")}</small>{conflict.fields.includes("note") && <><p>当前便签：{state[conflict.paperId]?.note || "（空）"}</p><p>备份便签：{backup.state[conflict.paperId]?.note || "（空）"}</p></>}</div>)}</details></>}
                <button className="button dark" onClick={restore}>确认恢复并保留便签</button><button className="button outline" onClick={() => setBackup(null)}>取消导入</button>
              </div>}
            </section>
            {error && <p className="records-error" role="alert">{error}</p>}
            <p role="status" className="records-feedback">{feedback}</p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
