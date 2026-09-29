import type { PaperUserState, UserStateMap } from "./types";

export function storageKey(datasetId: string): string {
  return `paper-aisle:${datasetId}:user-state:v1`;
}

function parseStoredState(value: string | null): UserStateMap | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function loadUserState(datasetId: string, legacyDatasetIds: string[] = []): UserStateMap {
  const current = parseStoredState(localStorage.getItem(storageKey(datasetId)));
  if (current) return current;

  for (const legacyDatasetId of legacyDatasetIds) {
    const legacy = parseStoredState(localStorage.getItem(storageKey(legacyDatasetId)));
    if (legacy) {
      localStorage.setItem(storageKey(datasetId), JSON.stringify(legacy));
      return legacy;
    }
  }
  return {};
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
