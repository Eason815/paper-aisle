import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import App from "../src/App";

function dataset(count = 2) {
  return {
    schemaVersion: 1,
    datasetId: "test-data",
    library: { name: "测试论文库", sources: [] },
    config: { displayLevels: ["里程碑", "精选"] },
    papers: Array.from({ length: count }, (_, index) => ({
      id: `paper-${index}`,
      title: index === 0 ? "扩散模型论文" : `论文 ${index}`,
      year: 2024 - (index % 4),
      direction: index % 2 ? "语言" : "视觉",
      displayLevel: index % 2 ? "精选" : "里程碑",
      recommendationScore: count - index,
      quickRead: { problem: "问题", finding: "发现", approach: "做法" },
      researchQuestion: "完整研究问题",
      method: "完整方法",
      findings: "完整发现",
    })),
  };
}

function mockFetch(data = dataset()) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => data }));
}

describe("Paper Aisle app", () => {
  it("searches, opens the drawer, favorites, and closes with Escape", async () => {
    mockFetch();
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "测试论文库" })).toBeInTheDocument();

    await user.type(screen.getByRole("searchbox", { name: "搜索论文" }), "扩散");
    await waitFor(() => expect(screen.getAllByRole("button", { name: "快速查看" })).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: "快速查看" }));
    const dialog = await screen.findByRole("dialog", { name: "论文详情" });
    expect(within(dialog).getByText("完整研究问题")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "收藏论文" }));
    expect(within(dialog).getByRole("button", { name: "已收藏" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "论文详情" })).not.toBeInTheDocument());
  });

  it("renders only the first 48 papers and loads the next batch on demand", async () => {
    mockFetch(dataset(60));
    const user = userEvent.setup();
    const { container } = render(<App />);
    await screen.findByRole("heading", { name: "测试论文库" });
    expect(container.querySelectorAll(".paper-card")).toHaveLength(48);
    await user.click(screen.getByRole("button", { name: "加载更多论文" }));
    expect(container.querySelectorAll(".paper-card")).toHaveLength(60);
  });

  it("shows a retry action when JSON loading fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    render(<App />);
    expect(await screen.findByRole("heading", { name: "论文库暂时无法打开" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新加载" })).toBeEnabled();
  });
});
