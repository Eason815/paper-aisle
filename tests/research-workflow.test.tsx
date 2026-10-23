import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { ReadingDiagram } from "../src/ReadingDiagram";
import { createBackup, loadUserState, mergeBackup, parseBackup, restoreConflicts, storageKey } from "../src/storage";
import { parseDataset } from "../src/types";
import library from "../public/data/papers.json";
import originalLibrary from "../data/library.before-round-one.json";

const dataset = parseDataset(library).dataset;

function mockLibrary() {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => library }));
}

describe("research dataset integration", () => {
  it("preserves every original paper and its state namespace, and imports all ten abstract records", () => {
    const parsed = parseDataset(library);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.dataset.papers).toHaveLength(22);
    expect(library.datasetId).toBe(originalLibrary.datasetId);
    for (const paper of originalLibrary.papers) expect(library.papers.find((item) => item.id === paper.id)).toEqual(paper);
    const current = dataset.collections.find((collection) => collection.id === dataset.config.defaultCollectionId)!;
    expect(current.paperIds).toHaveLength(10);
    expect(current.paperIds.every((id) => dataset.papers.some((paper) => paper.id === id && paper.quickRead?.finding))).toBe(true);
    expect(dataset.papers.filter((paper) => paper.readingGuide?.diagram)).toHaveLength(3);
  });

  it("defaults to the research collection and switches between all and historical papers", async () => {
    mockLibrary();
    const user = userEvent.setup();
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelectorAll(".paper-card")).toHaveLength(10));
    await user.click(screen.getByRole("button", { name: /全库.*22/ }));
    expect(container.querySelectorAll(".paper-card")).toHaveLength(22);
    await user.click(screen.getByRole("button", { name: /基础阅读.*12/ }));
    expect(container.querySelectorAll(".paper-card")).toHaveLength(12);
  });

  it("filters by research question and shows abstract content in the drawer without fulltext fields", async () => {
    mockLibrary();
    const user = userEvent.setup();
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelectorAll(".paper-card")).toHaveLength(10));
    await user.click(screen.getByRole("button", { name: "展开研究问题" }));
    await user.click(screen.getByRole("checkbox", { name: /记忆与状态/ }));
    expect(container.querySelectorAll(".paper-card")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Sculptor: Empowering LLMs with Cognitive Agency via Active Context Management" }));
    const dialog = await screen.findByRole("dialog", { name: "论文详情" });
    expect(within(dialog).getByText(/给Agent提供切分/)).toBeInTheDocument();
    expect(within(dialog).getByText(/论文报告：在所测长上下文基准上/)).toBeInTheDocument();
  });

  it("flushes a note before moving to the next paper and keeps the reading sequence stable", async () => {
    mockLibrary();
    const user = userEvent.setup();
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelectorAll(".paper-card")).toHaveLength(10));
    await user.click(screen.getByRole("button", { name: "OctoTools: A Multi-Agent Framework with Extensible Tools for Complex Reasoning" }));
    const dialog = await screen.findByRole("dialog", { name: "论文详情" });
    await user.type(within(dialog).getByRole("textbox", { name: /个人便签/ }), "需要比较工具调用预算 j");
    expect(within(dialog).getByText("OctoTools: A Multi-Agent Framework with Extensible Tools for Complex Reasoning", { selector: ".drawer-title" })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "下一篇论文" }));
    expect(loadUserState(dataset.datasetId)["acl-2026.acl-long.1"].note).toBe("需要比较工具调用预算 j");
    expect(within(dialog).getByRole("textbox", { name: /个人便签/ })).toHaveValue("");
    await user.click(within(dialog).getByRole("button", { name: "上一篇论文" }));
    expect(within(dialog).getByRole("textbox", { name: /个人便签/ })).toHaveValue("需要比较工具调用预算 j");
  });

  it("makes diagram explanations available through keyboard-operable buttons", async () => {
    const guide = dataset.papers.find((paper) => paper.id === "acl-2026.acl-long.1")!.readingGuide!;
    const user = userEvent.setup();
    render(<ReadingDiagram guide={guide} />);
    const executor = screen.getByRole("button", { name: /执行器/ });
    executor.focus();
    await user.keyboard("{Enter}");
    expect(executor).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/负责实际使用工具/)).toBeInTheDocument();
  });
});

describe("personal records backup", () => {
  it("round-trips all fields and retains records not in the current catalog", () => {
    const state = { old: { favorite: true, favoritedAt: 123, readingStatus: "reading" as const, tags: ["重点"], note: "我的理解" }, orphan: { note: "旧论文记录" } };
    expect(parseBackup(JSON.stringify(createBackup("dataset", state)), "dataset").state).toEqual(state);
  });

  it("rejects broken files, unknown status values, and mismatched dataset ids", () => {
    expect(() => parseBackup("not json", "a")).toThrow("JSON");
    expect(() => parseBackup(JSON.stringify(createBackup("a", {})), "b")).toThrow("不一致");
    const malformed = { ...createBackup("a", {}), state: { paper: { readingStatus: "done" } } };
    expect(() => parseBackup(JSON.stringify(malformed), "a")).toThrow("格式");
  });

  it("merges notes and tags without losing existing entries and lets status precedence be chosen", () => {
    const current = { a: { note: "当前便签", readingStatus: "read" as const, tags: ["重点"] }, untouched: { note: "保留" } };
    const incoming = { a: { note: "备份便签", readingStatus: "unread" as const, tags: ["复现"] }, new: { favorite: true } };
    expect(restoreConflicts(current, incoming)[0].fields).toEqual(["readingStatus", "note"]);
    const merged = mergeBackup(current, incoming, "current");
    expect(merged.a.note).toContain("当前便签");
    expect(merged.a.note).toContain("备份便签");
    expect(merged.a.tags).toEqual(["重点", "复现"]);
    expect(merged.a.readingStatus).toBe("read");
    expect(merged.untouched).toEqual(current.untouched);
    expect(merged.new.favorite).toBe(true);
    expect(mergeBackup(current, incoming, "backup").a.readingStatus).toBe("unread");
    expect(mergeBackup(merged, incoming, "current").a.note).toBe(merged.a.note);
  });

  it("previews a file without writing, then restores both conflicting notes on explicit confirmation", async () => {
    const id = "acl-2026.acl-long.1";
    const current = { [id]: { note: "当前想法", readingStatus: "read" as const } };
    localStorage.setItem(storageKey(dataset.datasetId), JSON.stringify(current));
    mockLibrary();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: dataset.library.name });
    await user.click(screen.getByRole("button", { name: "阅读记录" }));
    const dialog = await screen.findByRole("dialog", { name: "个人阅读记录" });
    const text = JSON.stringify(createBackup(dataset.datasetId, { [id]: { note: "备份想法", readingStatus: "unread" } }));
    const file = new File([text], "backup.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: async () => text });
    await user.upload(within(dialog).getByLabelText("选择个人记录备份"), file);
    expect(await within(dialog).findByRole("heading", { name: "恢复预览" })).toBeInTheDocument();
    expect(loadUserState(dataset.datasetId)[id].note).toBe("当前想法");
    await user.click(within(dialog).getByRole("button", { name: "确认恢复并保留便签" }));
    const restored = loadUserState(dataset.datasetId)[id];
    expect(restored.note).toContain("当前想法");
    expect(restored.note).toContain("备份想法");
    expect(restored.readingStatus).toBe("read");
  });
});
