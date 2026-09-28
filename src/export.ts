import type { Paper, UserStateMap } from "./types";
import { authorsOf, escapeBib, institutionsOf, readingLabels } from "./utils";

function safeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "paper-aisle";
}

export function markdownFor(papers: Paper[], userState: UserStateMap, libraryName: string): string {
  const lines = [`# ${libraryName} · 我的收藏`, ""];
  papers.forEach((paper) => {
    const state = userState[paper.id] ?? {};
    lines.push(`## ${paper.title}`, "");
    if (paper.authors?.length) lines.push(`- 作者：${authorsOf(paper)}`);
    if (paper.venue || paper.year) lines.push(`- 出处：${[paper.venue, paper.year].filter(Boolean).join(" · ")}`);
    lines.push(`- 阅读状态：${readingLabels[state.readingStatus ?? "unread"]}`);
    if (state.tags?.length) lines.push(`- 标签：${state.tags.join("、")}`);
    const firstLink = paper.links?.official ?? paper.links?.pdf ?? paper.links?.review;
    if (firstLink) lines.push(`- 链接：${firstLink}`);
    if (state.note?.trim()) lines.push("", "### 便签", "", state.note.trim());
    lines.push("");
  });
  return lines.join("\n");
}

export function bibtexFor(papers: Paper[], userState: UserStateMap): string {
  return papers.map((paper) => {
    const state = userState[paper.id] ?? {};
    const lead = paper.authors?.[0]?.name.split(/\s+/).at(-1) ?? "paper";
    const key = safeName(`${lead}-${paper.year ?? "nd"}-${paper.id}`).replace(/-/g, "_");
    const fields = [
      `  title = {${escapeBib(paper.title)}}`,
      paper.authors?.length ? `  author = {${paper.authors.map((a) => escapeBib(a.name)).join(" and ")}}` : undefined,
      paper.venue ? `  booktitle = {${escapeBib(paper.venue)}}` : undefined,
      paper.year ? `  year = {${paper.year}}` : undefined,
      institutionsOf(paper).length ? `  institution = {${escapeBib(institutionsOf(paper).join("; "))}}` : undefined,
      paper.links?.official ? `  url = {${paper.links.official}}` : undefined,
      state.tags?.length ? `  keywords = {${escapeBib(state.tags.join(", "))}}` : undefined,
      `  readstatus = {${readingLabels[state.readingStatus ?? "unread"]}}`,
      state.note?.trim() ? `  annote = {${escapeBib(state.note)}}` : undefined,
    ].filter(Boolean);
    return `@inproceedings{${key},\n${fields.join(",\n")}\n}`;
  }).join("\n\n");
}

export function downloadText(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function exportFilename(libraryName: string, extension: string): string {
  return `${safeName(libraryName)}-favorites.${extension}`;
}
