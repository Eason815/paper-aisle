import { parseDataset, type ParsedDataset } from "./types";

export async function loadDataset(signal?: AbortSignal): Promise<ParsedDataset> {
  const baseUrl = new URL(import.meta.env.BASE_URL, window.location.href);
  const dataUrl = new URL("data/papers.json", baseUrl).href;
  const response = await fetch(dataUrl, { cache: "no-store", signal });
  if (!response.ok) {
    throw new Error(`数据请求失败（HTTP ${response.status}）`);
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new Error("papers.json 不是有效的 JSON 文件");
  }
  return parseDataset(raw);
}
