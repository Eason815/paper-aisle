import { describe, expect, it } from "vitest";
import { bibtexFor, markdownFor } from "../src/export";
import { patchPaperState, storageKey } from "../src/storage";
import { emptyFilters, parseDataset, type Paper } from "../src/types";
import { categoryColor, matchesFilters, sortPapers } from "../src/utils";

const paperA: Paper = {
  id: "a",
  title: "Alpha",
  year: 2020,
  direction: "视觉",
  venue: "A",
  displayLevel: "精选",
  contributionTypes: ["方法", "系统"],
  recommendationScore: 2,
  authors: [{ name: "Ada Lovelace", affiliations: ["Lab A"] }],
};
const paperB: Paper = {
  id: "b",
  title: "Beta",
  year: 2024,
  direction: "语言",
  venue: "B",
  displayLevel: "里程碑",
  highlighted: true,
  recommendationScore: 8,
};

describe("dataset parsing", () => {
  it("keeps valid papers, skips duplicates, and hides invalid links", () => {
    const result = parseDataset({
      schemaVersion: 1,
      datasetId: "demo",
      library: { name: "Demo" },
      config: { displayLevels: [] },
      papers: [
        { id: "a", title: "Paper", links: { official: "javascript:alert(1)", pdf: "https://example.com/a.pdf" } },
        { id: "a", title: "Duplicate" },
        { title: "Missing id" },
      ],
    });
    expect(result.dataset.papers).toHaveLength(1);
    expect(result.dataset.papers[0].links).toEqual({ pdf: "https://example.com/a.pdf" });
    expect(result.warnings).toHaveLength(2);
  });

  it("rejects invalid root data", () => {
    expect(() => parseDataset({ papers: [] })).toThrow();
  });
});

describe("filtering and sorting", () => {
  it("uses OR within a facet and AND across facets", () => {
    const filters = { ...emptyFilters, directions: ["视觉", "语言"], years: ["2024"] };
    expect(matchesFilters(paperA, filters, {})).toBe(false);
    expect(matchesFilters(paperB, filters, {})).toBe(true);
  });

  it("sorts recommendation and configured display level deterministically", () => {
    expect(sortPapers([paperA, paperB], "recommended", ["里程碑", "精选"], {}, new Map())[0].id).toBe("b");
    expect(sortPapers([paperA, paperB], "displayLevel", ["里程碑", "精选"], {}, new Map())[0].id).toBe("b");
  });
});

describe("local state and export", () => {
  it("namespaces personal state by dataset id", () => {
    expect(storageKey("one")).toBe("paper-aisle:one:user-state:v1");
    expect(storageKey("two")).not.toBe(storageKey("one"));
    expect(patchPaperState({}, "a", { readingStatus: "read" }).a.readingStatus).toBe("read");
  });

  it("includes status, tags, and notes in both export formats", () => {
    const state = { a: { favorite: true, readingStatus: "reading" as const, tags: ["复现"], note: "检查基线" } };
    expect(markdownFor([paperA], state, "Demo")).toContain("在读");
    expect(markdownFor([paperA], state, "Demo")).toContain("检查基线");
    expect(bibtexFor([paperA], state)).toContain("readstatus = {在读}");
    expect(bibtexFor([paperA], state)).toContain("keywords = {复现}");
    expect(bibtexFor([paperA], state)).toContain("annote = {检查基线}");
  });
});

describe("stable colors", () => {
  it("is stable by category and respects an override", () => {
    expect(categoryColor("自然语言处理")).toBe(categoryColor("自然语言处理"));
    expect(categoryColor("自然语言处理")).not.toBe(categoryColor("计算机视觉"));
    expect(categoryColor("自然语言处理", { 自然语言处理: "#fff" })).toBe("#fff");
  });
});

