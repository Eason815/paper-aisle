import type { PaperUserState, UserStateMap } from "./types";

export function storageKey(datasetId: string): string {
  return `paper-aisle:${datasetId}:user-state:v1`;
}

export function loadUserState(datasetId: string): UserStateMap {
  try {
    const value = localStorage.getItem(storageKey(datasetId));
    if (!value) return {};
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function saveUserState(datasetId: string, state: UserStateMap): void {
  localStorage.setItem(storageKey(datasetId), JSON.stringify(state));
}

export function patchPaperState(
  current: UserStateMap,
  paperId: string,
  patch: Partial<PaperUserState>,
): UserStateMap {
  return {
    ...current,
    [paperId]: { ...current[paperId], ...patch },
  };
}
