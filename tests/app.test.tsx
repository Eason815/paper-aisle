import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import App from "../src/App";

function dataset(count = 2) {
  return {
    schemaVersion: 1,
    datasetId: "test-data",
    library: { name: "测试论文库", sources: [] },
    config: { directions: [] as string[], presentationTypes: ["Oral", "Poster"], notableInstitutions: [] },
    papers: Array.from({ length: count }, (_, index) => ({
      id: `paper-${index}`,
      title: index === 0 ? "扩散模型论文" : `论文 ${index}`,
      year: 2024 - (index % 4),
      direction: index % 2 ? "语言" : "视觉",
      presentationType: index % 2 ? "Poster" : "Oral",
      recommendationScore: count - index,
      quickRead: { problem: "问题", finding: "发现", approach: "做法" },
      researchQuestion: "完整研究问题",
      method: "完整方法",
      findings: "完整发现",
      links: undefined as { code: string } | undefined,
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

  it("uses configured core directions as a single-select filter", async () => {
    const data = dataset(3);
    data.config = { ...data.config, directions: ["Agent", "RL", "LLM"] };
    data.papers[0].direction = "Agent";
    data.papers[1].direction = "RL";
    data.papers[2].direction = "LLM";
    mockFetch(data);
    const user = userEvent.setup();
    const { container } = render(<App />);
    await screen.findByRole("heading", { name: "测试论文库" });

    await user.click(screen.getByRole("radio", { name: /RL 1/ }));
    expect(container.querySelectorAll(".paper-card")).toHaveLength(1);
    expect(screen.getByRole("radio", { name: /RL 1/ })).toBeChecked();

    await user.click(screen.getByRole("radio", { name: /LLM 1/ }));
    expect(container.querySelectorAll(".paper-card")).toHaveLength(1);
    expect(screen.getByRole("radio", { name: /RL 1/ })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /LLM 1/ })).toBeChecked();
  });

  it("keeps supplementary filters collapsed and applies a selected year", async () => {
    mockFetch(dataset(3));
    const user = userEvent.setup();
    const { container } = render(<App />);
    await screen.findByRole("heading", { name: "测试论文库" });

    expect(screen.queryByRole("checkbox", { name: /2024 1/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "展开年份" }));
    await user.click(screen.getByRole("checkbox", { name: /2024 1/ }));

    expect(container.querySelectorAll(".paper-card")).toHaveLength(1);
    expect(screen.getByRole("checkbox", { name: /2024 1/ })).toBeChecked();
    expect(screen.getByRole("button", { name: "年份：2024" })).toBeInTheDocument();
  });

  it("shows and cycles the reading status directly on a paper card", async () => {
    mockFetch(dataset(1));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "测试论文库" });

    const unread = screen.getByRole("button", { name: /标记为在读/ });
    expect(unread).toHaveTextContent("未读");
    await user.click(unread);
    expect(screen.getByRole("button", { name: /标记为已读/ })).toHaveTextContent("在读");
    await user.click(screen.getByRole("button", { name: /标记为已读/ }));
    expect(screen.getByRole("button", { name: /标记为未读/ })).toHaveTextContent("已读");
  });

  it("filters papers with a valid public code link", async () => {
    const data = dataset(3);
    data.papers[0].links = { code: "https://example.com/code" };
    mockFetch(data);
    const user = userEvent.setup();
    const { container } = render(<App />);
    await screen.findByRole("heading", { name: "测试论文库" });

    await user.click(screen.getByRole("checkbox", { name: /有公开代码/ }));
    expect(container.querySelectorAll(".paper-card")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "有公开代码" })).toBeInTheDocument();
  });

  it("shows a retry action when JSON loading fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    render(<App />);
    expect(await screen.findByRole("heading", { name: "论文库暂时无法打开" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新加载" })).toBeEnabled();
  });
});
