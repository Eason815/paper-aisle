import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (path) => JSON.parse((await readFile(resolve(root, path), "utf8")).replace(/^\uFEFF/, ""));
const config = await readJson("data/research-import.json");
const library = await readJson("public/data/papers.json");
const original = structuredClone(library);
const importedIds = new Set();
const collections = [...(library.collections ?? [])];
const questions = new Map((library.questionCatalog ?? []).map((question) => [question.id, question]));
const byId = new Map(library.papers.map((paper) => [paper.id, paper]));
const titleKey = (title) => title.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
const byTitle = new Map(library.papers.map((paper) => [titleKey(paper.title), paper.id]));
const report = { added: [], updated: [], unchanged: [], skipped: [], originalCount: library.papers.length, sourceBatches: [] };
const kindLabels = { method: "方法 / 系统", analysis: "实证分析", benchmark: "评测 / 基准" };

for (const input of config.batches) {
  const batch = await readJson(input.path);
  const guides = await readJson(input.guidesPath);
  report.sourceBatches.push({ batchId: batch.batchId, path: input.path, sha256: createHash("sha256").update(await readFile(resolve(root, input.path))).digest("hex") });
  for (const question of batch.questionCatalog) {
    if (questions.has(question.id) && JSON.stringify(questions.get(question.id)) !== JSON.stringify(question)) throw new Error(`研究问题编号冲突：${question.id}`);
    questions.set(question.id, question);
  }
  const memberIds = [];
  for (const record of batch.records) {
    const paper = record.paper;
    if (record.review.decision === "excluded" || record.verification.sourceLevel === "title" || !record.evidence?.length || !record.aiSummary.problem) {
      report.skipped.push(paper.id); continue;
    }
    if (importedIds.has(paper.id)) throw new Error(`批次内/跨批次 ID 重复：${paper.id}`);
    importedIds.add(paper.id);
    const titleMatch = byTitle.get(titleKey(paper.title));
    if (titleMatch && titleMatch !== paper.id) throw new Error(`同名工作需核实并映射 ID：${paper.id} / ${titleMatch}`);
    if (byId.has(paper.id) && byId.get(paper.id).title !== paper.title) throw new Error(`论文 ID 与标题冲突：${paper.id}`);
    const guide = guides[paper.id];
    const quickRead = Object.fromEntries(["problem", "finding", "approach"].filter((part) => record.aiSummary[part]).map((part) => [part, record.aiSummary[part]]));
    const projected = {
      ...paper,
      quickRead,
      questionId: record.review.mainQuestionId,
      scenarios: record.review.scenarios,
      ...(guide ? {
        contributionTypes: [kindLabels[guide.kind]],
        readingGuide: {
          ...guide,
          sourceLevel: record.verification.sourceLevel,
          sources: [{ label: `${paper.venue} 官方论文页`, url: paper.links.official, locator: "Abstract" }],
        },
      } : {}),
    };
    // No gate on track or human confirmation: these records are for browsing.
    const mergedPaper = { ...byId.get(paper.id), ...projected };
    if (!byId.has(paper.id)) report.added.push(paper.id);
    else if (JSON.stringify(byId.get(paper.id)) === JSON.stringify(mergedPaper)) report.unchanged.push(paper.id);
    else report.updated.push(paper.id);
    byId.set(paper.id, mergedPaper);
    byTitle.set(titleKey(paper.title), paper.id);
    memberIds.push(paper.id);
  }
  const collection = { ...input.collection, paperIds: memberIds };
  const index = collections.findIndex((item) => item.id === collection.id);
  if (index >= 0) collections[index] = collection; else collections.unshift(collection);
}
const legacyIds = [...byId.keys()].filter((id) => !importedIds.has(id));
const legacyCollection = { ...config.legacyCollection, paperIds: legacyIds };
const legacyIndex = collections.findIndex((item) => item.id === legacyCollection.id);
if (legacyIndex >= 0) collections[legacyIndex] = legacyCollection; else collections.push(legacyCollection);
library.papers = [...byId.values()];
library.collections = collections;
library.questionCatalog = [...questions.values()];
library.config = { ...library.config, defaultCollectionId: config.defaultCollectionId };
library.library.updatedAt = config.updatedAt;
const sources = [...(library.library.sources ?? [])];
for (const input of config.batches) {
  const batch = await readJson(input.path);
  for (const record of batch.records) {
    const url = new URL(record.paper.links.official).origin + "/";
    if (!sources.some((source) => source.url === url)) sources.push({ label: `${record.paper.venue} 官方论文页`, url });
  }
}
library.library.sources = sources;
if (library.datasetId !== original.datasetId) throw new Error("datasetId changed");
for (const paper of original.papers.filter((paper) => !importedIds.has(paper.id))) {
  if (JSON.stringify(byId.get(paper.id)) !== JSON.stringify(paper)) throw new Error(`旧论文被修改：${paper.id}`);
}
report.finalCount = library.papers.length;
report.preservedLegacyCount = legacyIds.length;
report.defaultCollectionCount = collections.find((item) => item.id === config.defaultCollectionId)?.paperIds.length ?? 0;
if (process.argv.includes("--write")) {
  await writeFile(resolve(root, "public/data/papers.json"), JSON.stringify(library, null, 2) + "\n");
  await writeFile(resolve(root, "data/import-report.json"), JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify({ mode: process.argv.includes("--write") ? "write" : "dry-run", ...report }, null, 2));
