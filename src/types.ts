import { z } from "zod";

const authorSchema = z.object({
  name: z.string().trim().min(1),
  affiliations: z.array(z.string().trim().min(1)).optional(),
});

const quickReadSchema = z.object({
  problem: z.string().trim().min(1).optional(),
  finding: z.string().trim().min(1).optional(),
  approach: z.string().trim().min(1).optional(),
});

const linksSchema = z.object({
  official: z.string().optional(),
  pdf: z.string().optional(),
  review: z.string().optional(),
  project: z.string().optional(),
  code: z.string().optional(),
});

const notableInstitutionSchema = z.object({
  name: z.string().trim().min(1),
  type: z.enum(["company", "university", "research"]),
  aliases: z.array(z.string().trim().min(1)).default([]),
});

export const paperSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  authors: z.array(authorSchema).optional(),
  venue: z.string().trim().min(1).optional(),
  year: z.number().int().min(1000).max(9999).optional(),
  direction: z.string().trim().min(1).optional(),
  subdirection: z.string().trim().min(1).optional(),
  presentationType: z.string().trim().min(1).optional(),
  /** @deprecated Use presentationType. Kept for v1 dataset compatibility. */
  displayLevel: z.string().trim().min(1).optional(),
  contributionTypes: z.array(z.string().trim().min(1)).optional(),
  highlighted: z.boolean().optional(),
  recommendationScore: z.number().finite().optional(),
  quickRead: quickReadSchema.optional(),
  researchQuestion: z.string().trim().min(1).optional(),
  method: z.string().trim().min(1).optional(),
  findings: z.string().trim().min(1).optional(),
  innovations: z.array(z.string().trim().min(1)).optional(),
  significance: z.string().trim().min(1).optional(),
  abstractExcerpt: z.string().trim().min(1).optional(),
  links: linksSchema.optional(),
});

const sourceSchema = z.object({
  label: z.string().trim().min(1),
  url: z.string().optional(),
});

const rootSchema = z.object({
  schemaVersion: z.literal(1),
  datasetId: z.string().trim().min(1),
  library: z.object({
    name: z.string().trim().min(1),
    description: z.string().trim().min(1).optional(),
    updatedAt: z.string().trim().min(1).optional(),
    sources: z.array(sourceSchema).optional(),
  }),
  config: z.object({
    directions: z.array(z.string().trim().min(1)).default([]),
    presentationTypes: z.array(z.string().trim().min(1)).default([]),
    /** @deprecated Use presentationTypes. */
    displayLevels: z.array(z.string().trim().min(1)).default([]),
    notableInstitutions: z.array(notableInstitutionSchema).default([]),
    categoryColors: z.record(z.string()).optional(),
  }).default({ directions: [], presentationTypes: [], displayLevels: [], notableInstitutions: [] }),
  papers: z.array(z.unknown()),
});

export type Paper = z.infer<typeof paperSchema>;
export type DatasetSource = z.infer<typeof sourceSchema>;
export type NotableInstitution = z.infer<typeof notableInstitutionSchema>;

export interface Dataset {
  schemaVersion: 1;
  datasetId: string;
  library: {
    name: string;
    description?: string;
    updatedAt?: string;
    sources?: DatasetSource[];
  };
  config: {
    directions: string[];
    presentationTypes: string[];
    notableInstitutions: NotableInstitution[];
    categoryColors?: Record<string, string>;
  };
  papers: Paper[];
}

export interface ParsedDataset {
  dataset: Dataset;
  warnings: string[];
}

function validHttpUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function sanitizePaper(paper: Paper): Paper {
  const entries = Object.entries(paper.links ?? {})
    .map(([key, value]) => [key, validHttpUrl(value)] as const)
    .filter((entry): entry is readonly [string, string] => Boolean(entry[1]));
  return {
    ...paper,
    presentationType: paper.presentationType ?? paper.displayLevel,
    links: entries.length ? Object.fromEntries(entries) : undefined,
  };
}

export function parseDataset(input: unknown): ParsedDataset {
  const root = rootSchema.safeParse(input);
  if (!root.success) {
    throw new Error(root.error.issues.map((issue) => issue.message).join("；"));
  }

  const warnings: string[] = [];
  const papers: Paper[] = [];
  const ids = new Set<string>();

  root.data.papers.forEach((candidate, index) => {
    const parsed = paperSchema.safeParse(candidate);
    if (!parsed.success) {
      warnings.push(`第 ${index + 1} 条记录缺少有效的 id 或 title，已跳过。`);
      return;
    }
    if (ids.has(parsed.data.id)) {
      warnings.push(`论文 id “${parsed.data.id}” 重复，后出现的记录已跳过。`);
      return;
    }
    ids.add(parsed.data.id);
    papers.push(sanitizePaper(parsed.data));
  });

  const usesLegacyPresentationFields = root.data.config.displayLevels.length > 0
    || papers.some((paper) => Boolean(paper.displayLevel));
  if (usesLegacyPresentationFields) {
    warnings.push("检测到旧版 displayLevel/displayLevels 字段；已兼容读取，建议迁移为 presentationType/presentationTypes。");
  }

  const sources = root.data.library.sources
    ?.map((source) => ({ ...source, url: validHttpUrl(source.url) }))
    .filter((source) => source.label);

  return {
    dataset: {
      schemaVersion: 1,
      datasetId: root.data.datasetId,
      library: { ...root.data.library, sources },
      config: {
        directions: root.data.config.directions,
        presentationTypes: root.data.config.presentationTypes.length
          ? root.data.config.presentationTypes
          : root.data.config.displayLevels,
        notableInstitutions: root.data.config.notableInstitutions,
        categoryColors: root.data.config.categoryColors,
      },
      papers,
    },
    warnings,
  };
}

export type ReadingStatus = "unread" | "reading" | "read";

export interface PaperUserState {
  favorite?: boolean;
  favoritedAt?: number;
  readingStatus?: ReadingStatus;
  note?: string;
  tags?: string[];
}

export type UserStateMap = Record<string, PaperUserState>;

export type FacetKey =
  | "directions"
  | "subdirections"
  | "years"
  | "venues"
  | "presentationTypes"
  | "contributionTypes"
  | "readingStatuses";

export interface Filters {
  directions: string[];
  subdirections: string[];
  years: string[];
  venues: string[];
  presentationTypes: string[];
  contributionTypes: string[];
  readingStatuses: ReadingStatus[];
  notableTeam: boolean;
  favorites: boolean;
  hasCode: boolean;
}

export type SortKey =
  | "recommended"
  | "relevance"
  | "presentationType"
  | "notableTeam"
  | "recentFavorite"
  | "title"
  | "year";

export const emptyFilters: Filters = {
  directions: [],
  subdirections: [],
  years: [],
  venues: [],
  presentationTypes: [],
  contributionTypes: [],
  readingStatuses: [],
  notableTeam: false,
  favorites: false,
  hasCode: false,
};
