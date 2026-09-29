import type { Filters, NotableInstitution, Paper, ReadingStatus, SortKey, UserStateMap } from "./types";

export const readingLabels: Record<ReadingStatus, string> = {
  unread: "未读",
  reading: "在读",
  read: "已读",
};

export function uniqueSorted(values: Array<string | number | undefined>, descending = false): string[] {
  const unique = [...new Set(values.filter((value): value is string | number => value !== undefined && value !== "").map(String))];
  return unique.sort((a, b) => descending
    ? b.localeCompare(a, "zh-CN", { numeric: true })
    : a.localeCompare(b, "zh-CN", { numeric: true }));
}

export function institutionsOf(paper: Paper): string[] {
  return [...new Set((paper.authors ?? []).flatMap((author) => author.affiliations ?? []))];
}

function normalizeInstitution(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en").replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
}

export function notableInstitutionsOf(paper: Paper, configured: NotableInstitution[]): NotableInstitution[] {
  const affiliations = institutionsOf(paper).map(normalizeInstitution);
  return configured.filter((institution) => {
    const candidates = [institution.name, ...institution.aliases].map(normalizeInstitution);
    return affiliations.some((affiliation) => candidates.some((candidate) =>
      affiliation === candidate || affiliation.includes(candidate),
    ));
  });
}

export function hasNotableTeam(paper: Paper, configured: NotableInstitution[]): boolean {
  return notableInstitutionsOf(paper, configured).length > 0;
}

export function authorsOf(paper: Paper): string {
  return (paper.authors ?? []).map((author) => author.name).join("、");
}

export function searchablePaper(paper: Paper): Record<string, string> {
  return {
    title: paper.title,
    authors: authorsOf(paper),
    institutions: institutionsOf(paper).join(" "),
    venue: paper.venue ?? "",
    year: paper.year?.toString() ?? "",
    direction: paper.direction ?? "",
    subdirection: paper.subdirection ?? "",
    quickRead: [paper.quickRead?.problem, paper.quickRead?.finding, paper.quickRead?.approach].filter(Boolean).join(" "),
  };
}

function includesAny(value: string | undefined, selected: string[]): boolean {
  return selected.length === 0 || Boolean(value && selected.includes(value));
}

export function matchesFilters(
  paper: Paper,
  filters: Filters,
  userState: UserStateMap,
  omit?: keyof Filters,
  notableInstitutions: NotableInstitution[] = [],
): boolean {
  const personal = userState[paper.id] ?? {};
  const status = personal.readingStatus ?? "unread";
  const checks: Record<keyof Filters, boolean> = {
    directions: includesAny(paper.direction, filters.directions),
    subdirections: includesAny(paper.subdirection, filters.subdirections),
    years: filters.years.length === 0 || Boolean(paper.year && filters.years.includes(String(paper.year))),
    venues: includesAny(paper.venue, filters.venues),
    presentationTypes: includesAny(paper.presentationType, filters.presentationTypes),
    contributionTypes: filters.contributionTypes.length === 0
      || Boolean(paper.contributionTypes?.some((type) => filters.contributionTypes.includes(type))),
    readingStatuses: filters.readingStatuses.length === 0 || filters.readingStatuses.includes(status),
    notableTeam: !filters.notableTeam || hasNotableTeam(paper, notableInstitutions),
    favorites: !filters.favorites || personal.favorite === true,
    hasCode: !filters.hasCode || Boolean(paper.links?.code),
  };
  return (Object.keys(checks) as Array<keyof Filters>).every((key) => key === omit || checks[key]);
}

function presentationRank(level: string | undefined, levels: string[]): number {
  if (!level) return Number.MAX_SAFE_INTEGER;
  const index = levels.indexOf(level);
  return index === -1 ? levels.length : index;
}

export function sortPapers(
  papers: Paper[],
  sort: SortKey,
  levels: string[],
  userState: UserStateMap,
  relevance: Map<string, number>,
  notableInstitutions: NotableInstitution[] = [],
): Paper[] {
  return [...papers].sort((a, b) => {
    if (sort === "relevance") {
      const diff = (relevance.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (relevance.get(b.id) ?? Number.MAX_SAFE_INTEGER);
      if (diff) return diff;
    }
    if (sort === "presentationType") {
      const diff = presentationRank(a.presentationType, levels) - presentationRank(b.presentationType, levels);
      if (diff) return diff;
    }
    if (sort === "notableTeam") {
      const diff = Number(hasNotableTeam(b, notableInstitutions)) - Number(hasNotableTeam(a, notableInstitutions));
      if (diff) return diff;
    }
    if (sort === "recentFavorite") {
      const diff = (userState[b.id]?.favoritedAt ?? 0) - (userState[a.id]?.favoritedAt ?? 0);
      if (diff) return diff;
    }
    if (sort === "title") return a.title.localeCompare(b.title, "en");
    if (sort === "year") {
      const diff = (b.year ?? 0) - (a.year ?? 0);
      if (diff) return diff;
    }
    if (sort === "recommended" || sort === "relevance") {
      const score = (b.recommendationScore ?? 0) - (a.recommendationScore ?? 0);
      if (score) return score;
      const team = Number(hasNotableTeam(b, notableInstitutions)) - Number(hasNotableTeam(a, notableInstitutions));
      if (team) return team;
      const level = presentationRank(a.presentationType, levels) - presentationRank(b.presentationType, levels);
      if (level) return level;
    }
    const year = (b.year ?? 0) - (a.year ?? 0);
    return year || a.title.localeCompare(b.title, "en");
  });
}

export function categoryColor(category: string, overrides?: Record<string, string>): string {
  if (overrides?.[category]) return overrides[category];
  let hash = 2166136261;
  for (const char of category) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  const hue = Math.abs(hash) % 360;
  return `oklch(82% 0.12 ${hue})`;
}

export function activeFilterCount(filters: Filters): number {
  return filters.directions.length + filters.subdirections.length + filters.years.length
    + filters.venues.length + filters.presentationTypes.length + filters.contributionTypes.length
    + filters.readingStatuses.length + Number(filters.notableTeam) + Number(filters.favorites)
    + Number(filters.hasCode);
}

export function escapeBib(value: string): string {
  return value.replace(/[{}]/g, "").replace(/\n+/g, " ").trim();
}
