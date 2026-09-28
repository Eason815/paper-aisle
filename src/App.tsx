import * as Dialog from "@radix-ui/react-dialog";
import Fuse from "fuse.js";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Bookmark,
  Check,
  Download,
  ExternalLink,
  GitCompare,
  Heart,
  Library,
  LoaderCircle,
  RotateCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Tag,
  X,
} from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { loadDataset } from "./data";
import { bibtexFor, downloadText, exportFilename, markdownFor } from "./export";
import { loadUserState, patchPaperState, saveUserState } from "./storage";
import {
  emptyFilters,
  type Dataset,
  type FacetKey,
  type Filters,
  type Paper,
  type PaperUserState,
  type ReadingStatus,
  type SortKey,
  type UserStateMap,
} from "./types";
import {
  activeFilterCount,
  authorsOf,
  categoryColor,
  institutionsOf,
  matchesFilters,
  readingLabels,
  sortPapers,
  uniqueSorted,
} from "./utils";

const PAGE_SIZE = 48;
const linkLabels: Record<string, string> = {
  official: "官方页面",
  pdf: "论文 PDF",
  review: "评审页面",
  project: "项目页面",
  code: "代码仓库",
};

const sortOptions: Array<{ value: SortKey; label: string }> = [
  { value: "recommended", label: "推荐排序" },
  { value: "relevance", label: "相关度" },
  { value: "displayLevel", label: "展示等级" },
  { value: "highlighted", label: "重点论文优先" },
  { value: "recentFavorite", label: "最近收藏" },
  { value: "title", label: "标题 A–Z" },
  { value: "year", label: "年份从新到旧" },
];

function usePaperData() {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    loadDataset(controller.signal)
      .then((result) => {
        setDataset(result.dataset);
        setWarnings(result.warnings);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "无法读取论文数据");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [attempt]);

  return { dataset, warnings, error, loading, reload: () => setAttempt((value) => value + 1) };
}

function Logo() {
  return (
    <div className="brand" aria-label="Paper Aisle">
      <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
      <span>
        <strong>PAPER AISLE</strong>
        <small>论文经过，更多被发现</small>
      </span>
    </div>
  );
}

function LoadingState() {
  return (
    <main className="state-page" aria-busy="true" aria-live="polite">
      <Logo />
      <div className="loading-ticket">
        <LoaderCircle className="spin" aria-hidden="true" />
        <strong>正在整理论文货架</strong>
        <span>读取并校验 papers.json…</span>
      </div>
      <div className="skeleton-grid" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => <div className="skeleton-card" key={index} />)}
      </div>
    </main>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className="state-page error-state">
      <Logo />
      <section className="error-ticket" role="alert">
        <AlertTriangle aria-hidden="true" />
        <p className="eyebrow">DATA LOAD FAILED</p>
        <h1>论文库暂时无法打开</h1>
        <p>{message}</p>
        <button className="button dark" onClick={onRetry}><RotateCw size={18} />重新加载</button>
      </section>
    </main>
  );
}

function CategoryStats({ papers, dataset }: { papers: Paper[]; dataset: Dataset }) {
  const stats = useMemo(() => {
    const counts = new Map<string, number>();
    papers.forEach((paper) => {
      if (paper.direction) counts.set(paper.direction, (counts.get(paper.direction) ?? 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [papers]);

  if (!stats.length) return null;
  return (
    <div className="category-stats" aria-label="分类统计">
      {stats.map(([category, count]) => (
        <span key={category}>
          <i style={{ "--category": categoryColor(category, dataset.config.categoryColors) } as CSSProperties} />
          {category}<b>{count}</b>
        </span>
      ))}
    </div>
  );
}

type FacetDefinition = {
  key: FacetKey;
  label: string;
  options: string[];
  paperValues: (paper: Paper, state: UserStateMap) => string[];
};

function FilterPanel({
  dataset,
  searchable,
  filters,
  userState,
  onChange,
  onReset,
}: {
  dataset: Dataset;
  searchable: Paper[];
  filters: Filters;
  userState: UserStateMap;
  onChange: (next: Filters) => void;
  onReset: () => void;
}) {
  const papers = dataset.papers;
  const allowedSubdirections = filters.directions.length
    ? papers.filter((paper) => paper.direction && filters.directions.includes(paper.direction))
    : papers;
  const facets: FacetDefinition[] = [
    { key: "directions", label: "研究方向", options: uniqueSorted(papers.map((p) => p.direction)), paperValues: (p) => p.direction ? [p.direction] : [] },
    { key: "subdirections", label: "子方向", options: uniqueSorted(allowedSubdirections.map((p) => p.subdirection)), paperValues: (p) => p.subdirection ? [p.subdirection] : [] },
    { key: "years", label: "年份", options: uniqueSorted(papers.map((p) => p.year), true), paperValues: (p) => p.year ? [String(p.year)] : [] },
    { key: "venues", label: "会议 / 来源", options: uniqueSorted(papers.map((p) => p.venue)), paperValues: (p) => p.venue ? [p.venue] : [] },
    { key: "displayLevels", label: "展示等级", options: dataset.config.displayLevels.length ? dataset.config.displayLevels : uniqueSorted(papers.map((p) => p.displayLevel)), paperValues: (p) => p.displayLevel ? [p.displayLevel] : [] },
    { key: "contributionTypes", label: "贡献类型", options: uniqueSorted(papers.flatMap((p) => p.contributionTypes ?? [])), paperValues: (p) => p.contributionTypes ?? [] },
    { key: "readingStatuses", label: "阅读状态", options: ["unread", "reading", "read"], paperValues: (p, state) => [state[p.id]?.readingStatus ?? "unread"] },
  ];

  const toggle = (key: FacetKey, value: string) => {
    const current = filters[key] as string[];
    const next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
    onChange({ ...filters, [key]: next });
  };

  return (
    <div className="filter-panel">
      <div className="filter-heading">
        <span><SlidersHorizontal size={17} />筛选 / FILTERS</span>
        {activeFilterCount(filters) > 0 && <button onClick={onReset}>清空</button>}
      </div>
      <div className="filter-specials">
        <label>
          <input type="checkbox" checked={filters.highlighted} onChange={(event) => onChange({ ...filters, highlighted: event.target.checked })} />
          <Sparkles size={16} /><span>重点论文</span>
          <b>{papers.filter((paper) => paper.highlighted).length}</b>
        </label>
        <label>
          <input type="checkbox" checked={filters.favorites} onChange={(event) => onChange({ ...filters, favorites: event.target.checked })} />
          <Heart size={16} /><span>我的收藏</span>
          <b>{papers.filter((paper) => userState[paper.id]?.favorite).length}</b>
        </label>
      </div>
      {facets.filter((facet) => facet.options.length).map((facet) => (
        <fieldset key={facet.key}>
          <legend>{facet.label}</legend>
          <div className="facet-options">
            {facet.options.map((option) => {
              const count = searchable.filter((paper) =>
                matchesFilters(paper, filters, userState, facet.key)
                && facet.paperValues(paper, userState).includes(option),
              ).length;
              const selected = (filters[facet.key] as string[]).includes(option);
              return (
                <label key={option} className={count === 0 && !selected ? "disabled" : ""}>
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={count === 0 && !selected}
                    onChange={() => toggle(facet.key, option)}
                  />
                  <span>{facet.key === "readingStatuses" ? readingLabels[option as ReadingStatus] : option}</span>
                  <b>{count}</b>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function FilterChips({ filters, onChange, onReset }: { filters: Filters; onChange: (filters: Filters) => void; onReset: () => void }) {
  const chips: Array<{ key: FacetKey; value: string; label: string }> = [];
  const facetLabels: Record<FacetKey, string> = {
    directions: "方向",
    subdirections: "子方向",
    years: "年份",
    venues: "会议",
    displayLevels: "等级",
    contributionTypes: "贡献",
    readingStatuses: "状态",
  };
  (Object.keys(facetLabels) as FacetKey[]).forEach((key) => {
    (filters[key] as string[]).forEach((value) => chips.push({
      key,
      value,
      label: `${facetLabels[key]}：${key === "readingStatuses" ? readingLabels[value as ReadingStatus] : value}`,
    }));
  });
  if (filters.highlighted) chips.push({ key: "directions", value: "__highlighted", label: "重点论文" });
  if (filters.favorites) chips.push({ key: "directions", value: "__favorites", label: "我的收藏" });
  if (!chips.length) return null;

  const remove = (chip: typeof chips[number]) => {
    if (chip.value === "__highlighted") return onChange({ ...filters, highlighted: false });
    if (chip.value === "__favorites") return onChange({ ...filters, favorites: false });
    onChange({ ...filters, [chip.key]: (filters[chip.key] as string[]).filter((item) => item !== chip.value) });
  };

  return (
    <div className="filter-chips" aria-label="已选筛选条件">
      {chips.map((chip) => <button key={`${chip.key}-${chip.value}`} onClick={() => remove(chip)}>{chip.label}<X size={14} /></button>)}
      <button className="clear-chip" onClick={onReset}>清空全部</button>
    </div>
  );
}

function QuickRead({ paper }: { paper: Paper }) {
  const rows = [
    ["问题", paper.quickRead?.problem],
    ["发现", paper.quickRead?.finding],
    ["做法", paper.quickRead?.approach],
  ].filter((row): row is [string, string] => Boolean(row[1]));
  if (!rows.length) return null;
  return (
    <div className="quick-read">
      <p className="mini-label">通俗速读</p>
      {rows.map(([label, value]) => <div key={label}><b>{label}</b><p>{value}</p></div>)}
    </div>
  );
}

function PaperCard({
  paper,
  dataset,
  state,
  comparing,
  onOpen,
  onFavorite,
  onStatus,
  onCompare,
}: {
  paper: Paper;
  dataset: Dataset;
  state: PaperUserState;
  comparing: boolean;
  onOpen: () => void;
  onFavorite: () => void;
  onStatus: () => void;
  onCompare: () => void;
}) {
  const authors = paper.authors ?? [];
  const institutions = institutionsOf(paper);
  const color = categoryColor(paper.direction ?? "未分类", dataset.config.categoryColors);
  return (
    <article className="paper-card" style={{ "--category": color } as CSSProperties}>
      <div className="card-stripe" aria-hidden="true" />
      <div className="card-content">
        <div className="paper-tags">
          {paper.displayLevel && <span className="level-tag">{paper.displayLevel}</span>}
          {paper.highlighted && <span className="focus-tag"><Sparkles size={13} />重点</span>}
          {paper.direction && <span className="category-tag">{paper.direction}</span>}
        </div>
        <button className="paper-title" onClick={onOpen}><h2>{paper.title}</h2></button>
        {authors.length > 0 && <p className="authors" title={authorsOf(paper)}>{authors.slice(0, 4).map((a) => a.name).join("、")}{authors.length > 4 ? ` 等 ${authors.length} 人` : ""}</p>}
        {institutions.length > 0 && <p className="institutions" title={institutions.join("、")}>{institutions.slice(0, 2).join(" · ")}{institutions.length > 2 ? ` +${institutions.length - 2}` : ""}</p>}
        <div className="meta-line">
          {paper.subdirection && <span>{paper.subdirection}</span>}
          {paper.venue && <span>{paper.venue}</span>}
          {paper.year && <span>{paper.year}</span>}
        </div>
        <QuickRead paper={paper} />
      </div>
      <div className="ticket-edge" aria-hidden="true" />
      <div className="card-actions">
        <button className="button dark card-open" onClick={onOpen}>快速查看<ArrowRight size={17} /></button>
        <button className="icon-button" aria-label={`将 ${paper.title} 标记为${readingLabels[state.readingStatus === "unread" || !state.readingStatus ? "reading" : state.readingStatus === "reading" ? "read" : "unread"]}`} onClick={onStatus}>
          <BookOpen size={17} /><span>{readingLabels[state.readingStatus ?? "unread"]}</span>
        </button>
        <button className={`icon-button ${state.favorite ? "active favorite" : ""}`} aria-label={state.favorite ? `取消收藏 ${paper.title}` : `收藏 ${paper.title}`} aria-pressed={Boolean(state.favorite)} onClick={onFavorite}>
          <Heart size={17} fill={state.favorite ? "currentColor" : "none"} /><span>收藏</span>
        </button>
        <button className={`icon-button ${comparing ? "active" : ""}`} aria-label={comparing ? `从对比中移除 ${paper.title}` : `将 ${paper.title} 加入对比`} aria-pressed={comparing} onClick={onCompare}>
          <GitCompare size={17} /><span>对比</span>
        </button>
      </div>
    </article>
  );
}

function ModalFrame({
  open,
  onOpenChange,
  title,
  description,
  className = "",
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className={`dialog-content ${className}`} aria-describedby={undefined}>
          <div className="dialog-topbar">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>{description}</Dialog.Description>
            </div>
            <Dialog.Close className="dialog-close" aria-label="关闭"><X size={20} /></Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DetailDrawer({
  paper,
  dataset,
  open,
  state,
  comparing,
  saved,
  onOpenChange,
  onPatch,
  onCompare,
}: {
  paper: Paper | null;
  dataset: Dataset;
  open: boolean;
  state: PaperUserState;
  comparing: boolean;
  saved: boolean;
  onOpenChange: (open: boolean) => void;
  onPatch: (patch: Partial<PaperUserState>) => void;
  onCompare: () => void;
}) {
  const [tagInput, setTagInput] = useState("");
  if (!paper) return null;
  const color = categoryColor(paper.direction ?? "未分类", dataset.config.categoryColors);
  const contentSections = [
    ["研究问题", paper.researchQuestion],
    ["方法", paper.method],
    ["主要发现", paper.findings],
    ["研究意义", paper.significance],
  ].filter((row): row is [string, string] => Boolean(row[1]));
  const links = Object.entries(paper.links ?? {});
  const tags = state.tags ?? [];
  const addTag = () => {
    const value = tagInput.trim();
    if (!value || tags.includes(value)) return;
    onPatch({ tags: [...tags, value] });
    setTagInput("");
  };

  return (
    <ModalFrame open={open} onOpenChange={onOpenChange} title="论文详情" description={paper.title} className="detail-drawer">
      <div className="drawer-body" style={{ "--category": color } as CSSProperties}>
        <div className="drawer-ticket">
          <span>{paper.id}</span>
          {paper.displayLevel && <b>{paper.displayLevel}</b>}
        </div>
        <div className="paper-tags">
          {paper.direction && <span className="category-tag">{paper.direction}</span>}
          {paper.subdirection && <span>{paper.subdirection}</span>}
          {paper.highlighted && <span className="focus-tag"><Sparkles size={13} />重点</span>}
        </div>
        <h2 className="drawer-title">{paper.title}</h2>
        {paper.authors?.length && (
          <div className="full-team">
            {paper.authors.map((author) => (
              <p key={`${author.name}-${author.affiliations?.join("-")}`}><strong>{author.name}</strong>{author.affiliations?.length ? <span>{author.affiliations.join(" · ")}</span> : null}</p>
            ))}
          </div>
        )}
        {(paper.venue || paper.year) && <p className="drawer-venue">{[paper.venue, paper.year].filter(Boolean).join(" · ")}</p>}

        {paper.abstractExcerpt && <blockquote><span>摘要摘录 / ABSTRACT SIGNAL</span>{paper.abstractExcerpt}</blockquote>}
        {contentSections.map(([label, value]) => (
          <section className="detail-section" key={label}><h3>{label}</h3><p>{value}</p></section>
        ))}
        {paper.innovations?.length && <section className="detail-section"><h3>创新点</h3><ul>{paper.innovations.map((item) => <li key={item}>{item}</li>)}</ul></section>}
        {links.length > 0 && (
          <div className="link-grid" aria-label="论文链接">
            {links.map(([key, href]) => <a key={key} href={href} target="_blank" rel="noreferrer">{linkLabels[key] ?? key}<ExternalLink size={15} /></a>)}
          </div>
        )}

        <section className="personal-section">
          <p className="mini-label">个人研究小票 / MY NOTES</p>
          <div className="personal-actions">
            <button className={`button ${state.favorite ? "yellow" : "outline"}`} onClick={() => onPatch({ favorite: !state.favorite, favoritedAt: !state.favorite ? Date.now() : undefined })}>
              <Heart size={17} fill={state.favorite ? "currentColor" : "none"} />{state.favorite ? "已收藏" : "收藏论文"}
            </button>
            <button className={`button ${comparing ? "mint" : "outline"}`} onClick={onCompare}><GitCompare size={17} />{comparing ? "已加入对比" : "加入对比"}</button>
          </div>
          <div className="status-group" aria-label="阅读状态">
            {(Object.keys(readingLabels) as ReadingStatus[]).map((status) => (
              <button key={status} className={(state.readingStatus ?? "unread") === status ? "active" : ""} onClick={() => onPatch({ readingStatus: status })}>{readingLabels[status]}</button>
            ))}
          </div>
          <div className="tags-editor">
            <div className="tag-list">
              {tags.map((tag) => <button key={tag} onClick={() => onPatch({ tags: tags.filter((item) => item !== tag) })} title="移除此标签"><Tag size={13} />{tag}<X size={12} /></button>)}
            </div>
            <div className="tag-input">
              <input value={tagInput} onChange={(event) => setTagInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addTag(); } }} placeholder="输入标签后按 Enter" aria-label="添加标签" />
              <button onClick={addTag} disabled={!tagInput.trim()}>添加</button>
            </div>
          </div>
          <label className="note-field">
            <span>个人便签 <small aria-live="polite">{saved ? <><Check size={13} />已保存</> : "保存中…"}</small></span>
            <textarea value={state.note ?? ""} onChange={(event) => onPatch({ note: event.target.value })} placeholder="记录复现实验、可借鉴方法或下一步问题…" rows={6} />
          </label>
        </section>
      </div>
    </ModalFrame>
  );
}

function FavoritesDialog({
  open,
  onOpenChange,
  papers,
  dataset,
  userState,
  onOpenPaper,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  papers: Paper[];
  dataset: Dataset;
  userState: UserStateMap;
  onOpenPaper: (paper: Paper) => void;
}) {
  const downloadMarkdown = () => downloadText(exportFilename(dataset.library.name, "md"), markdownFor(papers, userState, dataset.library.name), "text/markdown;charset=utf-8");
  const downloadBibtex = () => downloadText(exportFilename(dataset.library.name, "bib"), bibtexFor(papers, userState), "application/x-bibtex;charset=utf-8");
  return (
    <ModalFrame open={open} onOpenChange={onOpenChange} title="我的收藏" description={`${papers.length} 篇论文`} className="favorites-dialog">
      <div className="modal-body">
        <div className="export-bar">
          <p>导出会包含阅读状态、标签和个人便签。</p>
          <div>
            <button className="button outline" disabled={!papers.length} onClick={downloadMarkdown}><Download size={16} />Markdown</button>
            <button className="button dark" disabled={!papers.length} onClick={downloadBibtex}><Download size={16} />BibTeX</button>
          </div>
        </div>
        {!papers.length ? (
          <div className="empty-modal"><Bookmark size={30} /><h3>收藏夹还是空的</h3><p>在论文卡片或详情中点击“收藏”，这里就会出现可导出的清单。</p></div>
        ) : (
          <div className="favorite-list">
            {papers.map((paper, index) => (
              <button key={paper.id} onClick={() => onOpenPaper(paper)}>
                <b>{String(index + 1).padStart(2, "0")}</b>
                <span><strong>{paper.title}</strong><small>{[paper.venue, paper.year, readingLabels[userState[paper.id]?.readingStatus ?? "unread"]].filter(Boolean).join(" · ")}</small></span>
                <ArrowRight size={18} />
              </button>
            ))}
          </div>
        )}
      </div>
    </ModalFrame>
  );
}

function CompareDialog({ open, onOpenChange, papers }: { open: boolean; onOpenChange: (open: boolean) => void; papers: Paper[] }) {
  const allRows: Array<[string, (paper: Paper) => string | undefined]> = [
    ["研究问题", (paper) => paper.researchQuestion ?? paper.quickRead?.problem],
    ["方法", (paper) => paper.method ?? paper.quickRead?.approach],
    ["主要发现", (paper) => paper.findings ?? paper.quickRead?.finding],
    ["研究意义", (paper) => paper.significance],
    ["团队", (paper) => [authorsOf(paper), institutionsOf(paper).join("、")].filter(Boolean).join("\n") || undefined],
  ];
  const rows = allRows.filter(([, getter]) => papers.some((paper) => getter(paper)));
  return (
    <ModalFrame open={open} onOpenChange={onOpenChange} title="横向对比" description={`${papers.length} 篇论文`} className="compare-dialog">
      <div className="compare-scroll">
        <div className="compare-grid" style={{ gridTemplateColumns: `10rem repeat(${papers.length}, minmax(16rem, 1fr))` }}>
          <div className="compare-corner">比较维度</div>
          {papers.map((paper, index) => <div className="compare-paper" key={paper.id}><span>0{index + 1}</span><h3>{paper.title}</h3><p>{[paper.venue, paper.year].filter(Boolean).join(" · ")}</p></div>)}
          {rows.map(([label, getter]) => (
            <Fragment key={label}>
              <div className="compare-label">{label}</div>
              {papers.map((paper) => <div className="compare-value" key={`${label}-${paper.id}`}>{getter(paper)?.split("\n").map((line) => <p key={line}>{line}</p>) ?? "—"}</div>)}
            </Fragment>
          ))}
        </div>
      </div>
    </ModalFrame>
  );
}

function ComparisonTray({ papers, onRemove, onOpen }: { papers: Paper[]; onRemove: (id: string) => void; onOpen: () => void }) {
  if (!papers.length) return null;
  return (
    <div className="comparison-tray" role="region" aria-label="论文对比栏">
      <div className="comparison-label"><GitCompare size={18} /><strong>对比清单</strong><span>{papers.length} / 3</span></div>
      <div className="comparison-items">
        {papers.map((paper, index) => <div key={paper.id}><b>{index + 1}</b><span>{paper.title}</span><button onClick={() => onRemove(paper.id)} aria-label={`从对比中移除 ${paper.title}`}><X size={15} /></button></div>)}
        {papers.length < 3 && <span className="comparison-placeholder">还可加入 {3 - papers.length} 篇</span>}
      </div>
      <button className="button dark" disabled={papers.length < 2} onClick={onOpen}>开始对比<ArrowRight size={17} /></button>
    </div>
  );
}

function EmptyResults({ hasFilters, onReset }: { hasFilters: boolean; onReset: () => void }) {
  return (
    <div className="empty-results">
      <Search size={30} />
      <h2>{hasFilters ? "没有论文同时满足这些条件" : "论文库暂时为空"}</h2>
      <p>{hasFilters ? "试试减少筛选条件，或换一个搜索词。" : "请在 papers.json 中加入论文记录后重新加载。"}</p>
      {hasFilters && <button className="button dark" onClick={onReset}>清空搜索和筛选</button>}
    </div>
  );
}

function App() {
  const { dataset, warnings, error, loading, reload } = usePaperData();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recommended");
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [userState, setUserState] = useState<UserStateMap>({});
  const [stateReady, setStateReady] = useState(false);
  const [saved, setSaved] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [notice, setNotice] = useState<string | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dataset) return;
    setUserState(loadUserState(dataset.datasetId));
    setStateReady(true);
  }, [dataset]);

  useEffect(() => {
    if (!dataset || !stateReady) return;
    setSaved(false);
    const timeout = window.setTimeout(() => {
      saveUserState(dataset.datasetId, userState);
      setSaved(true);
    }, 450);
    return () => window.clearTimeout(timeout);
  }, [dataset, stateReady, userState]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const patchState = useCallback((paperId: string, patch: Partial<PaperUserState>) => {
    setUserState((current) => patchPaperState(current, paperId, patch));
  }, []);

  const toggleFavorite = useCallback((paperId: string) => {
    setUserState((current) => {
      const favorite = !current[paperId]?.favorite;
      return patchPaperState(current, paperId, { favorite, favoritedAt: favorite ? Date.now() : undefined });
    });
  }, []);

  const cycleStatus = useCallback((paperId: string) => {
    setUserState((current) => {
      const status = current[paperId]?.readingStatus ?? "unread";
      const next: ReadingStatus = status === "unread" ? "reading" : status === "reading" ? "read" : "unread";
      return patchPaperState(current, paperId, { readingStatus: next });
    });
  }, []);

  const toggleCompare = useCallback((paperId: string) => {
    setCompareIds((current) => {
      if (current.includes(paperId)) return current.filter((id) => id !== paperId);
      if (current.length >= 3) {
        setNotice("最多同时对比三篇论文；请先移除一篇。 ");
        return current;
      }
      return [...current, paperId];
    });
  }, []);

  const papers = dataset?.papers ?? [];
  const fuse = useMemo(() => new Fuse(papers, {
    keys: [
      { name: "title", weight: 0.36 },
      { name: "authors.name", weight: 0.14 },
      { name: "authors.affiliations", weight: 0.12 },
      { name: "venue", weight: 0.08 },
      { name: "year", weight: 0.04 },
      { name: "direction", weight: 0.08 },
      { name: "subdirection", weight: 0.06 },
      { name: "quickRead.problem", weight: 0.04 },
      { name: "quickRead.finding", weight: 0.04 },
      { name: "quickRead.approach", weight: 0.04 },
    ],
    includeScore: true,
    ignoreLocation: true,
    threshold: 0.42,
    minMatchCharLength: 1,
  }), [papers]);

  const searchResults = useMemo(() => query.trim() ? fuse.search(query.trim()) : [], [fuse, query]);
  const searchablePapers = useMemo(() => query.trim() ? searchResults.map((result) => result.item) : papers, [papers, query, searchResults]);
  const relevance = useMemo(() => new Map(searchResults.map((result) => [result.item.id, result.score ?? 1])), [searchResults]);
  const effectiveSort = sort === "relevance" && !query.trim() ? "recommended" : sort;
  const filteredPapers = useMemo(() => searchablePapers.filter((paper) => matchesFilters(paper, filters, userState)), [searchablePapers, filters, userState]);
  const sortedPapers = useMemo(() => sortPapers(filteredPapers, effectiveSort, dataset?.config.displayLevels ?? [], userState, relevance), [filteredPapers, effectiveSort, dataset, userState, relevance]);
  const visiblePapers = sortedPapers.slice(0, visibleCount);
  const favoritePapers = useMemo(() => papers.filter((paper) => userState[paper.id]?.favorite).sort((a, b) => (userState[b.id]?.favoritedAt ?? 0) - (userState[a.id]?.favoritedAt ?? 0)), [papers, userState]);
  const comparePapers = compareIds.map((id) => papers.find((paper) => paper.id === id)).filter((paper): paper is Paper => Boolean(paper));
  const selectedPaper = papers.find((paper) => paper.id === selectedId) ?? null;

  useEffect(() => setVisibleCount(PAGE_SIZE), [query, filters, sort]);
  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || visibleCount >= sortedPapers.length) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisibleCount((count) => Math.min(count + PAGE_SIZE, sortedPapers.length));
    }, { rootMargin: "240px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [sortedPapers.length, visibleCount]);

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool || !dataset) return;
    const lifecycle = new AbortController();
    const safeRegister = (tool: ModelContextTool) => {
      try { void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => undefined); } catch { /* optional browser capability */ }
    };
    safeRegister({
      name: "search_papers",
      title: "搜索论文",
      description: "在当前 Paper Aisle 数据集中搜索论文，并返回最多十条结果。",
      inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input) => {
        const value = typeof input === "object" && input && "query" in input ? String((input as { query: unknown }).query) : "";
        if (!value.trim()) throw new Error("query 不能为空");
        setQuery(value);
        return fuse.search(value).slice(0, 10).map((result) => ({ id: result.item.id, title: result.item.title, score: result.score }));
      },
    });
    safeRegister({
      name: "set_paper_reading_status",
      title: "更新阅读状态",
      description: "把一篇论文标记为未读、在读或已读，并同步更新可见界面。",
      inputSchema: { type: "object", properties: { paperId: { type: "string" }, status: { enum: ["unread", "reading", "read"] } }, required: ["paperId", "status"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: (input) => {
        const value = input as { paperId?: string; status?: ReadingStatus };
        if (!value.paperId || !papers.some((paper) => paper.id === value.paperId) || !value.status || !(value.status in readingLabels)) throw new Error("论文或状态无效");
        patchState(value.paperId, { readingStatus: value.status });
        return { paperId: value.paperId, status: value.status };
      },
    });
    safeRegister({
      name: "favorite_paper",
      title: "设置论文收藏",
      description: "收藏或取消收藏一篇论文，并同步更新收藏夹。",
      inputSchema: { type: "object", properties: { paperId: { type: "string" }, favorite: { type: "boolean" } }, required: ["paperId", "favorite"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: (input) => {
        const value = input as { paperId?: string; favorite?: boolean };
        if (!value.paperId || !papers.some((paper) => paper.id === value.paperId) || typeof value.favorite !== "boolean") throw new Error("论文或收藏值无效");
        patchState(value.paperId, { favorite: value.favorite, favoritedAt: value.favorite ? Date.now() : undefined });
        return { paperId: value.paperId, favorite: value.favorite };
      },
    });
    return () => lifecycle.abort();
  }, [dataset, fuse, papers, patchState]);

  if (loading) return <LoadingState />;
  if (error || !dataset) return <ErrorState message={error ?? "未获得有效数据集"} onRetry={reload} />;

  const resetAll = () => {
    setQuery("");
    setFilters(emptyFilters);
  };

  return (
    <div className="app-shell">
      <header className="site-header">
        <Logo />
        <nav aria-label="当前页面"><span className="active">全部论文</span></nav>
        <button className="favorites-button" onClick={() => setFavoritesOpen(true)}><Heart size={17} />我的收藏<b>{favoritePapers.length}</b></button>
      </header>

      <main>
        <section className="library-intro">
          <div>
            <p className="eyebrow">DATASET · {dataset.datasetId}</p>
            <h1>{dataset.library.name}</h1>
            {dataset.library.description && <p>{dataset.library.description}</p>}
          </div>
          <div className="library-facts">
            <span><Library size={20} /><b>{papers.length}</b><small>论文总数</small></span>
            <span><Bookmark size={20} /><b>{favoritePapers.length}</b><small>我的收藏</small></span>
            {dataset.library.updatedAt && <span><Check size={20} /><b>{dataset.library.updatedAt}</b><small>数据更新</small></span>}
          </div>
          <CategoryStats papers={papers} dataset={dataset} />
          {dataset.library.sources?.length ? <div className="source-line"><span>数据来源</span>{dataset.library.sources.map((source) => source.url ? <a key={source.label} href={source.url} target="_blank" rel="noreferrer">{source.label}<ExternalLink size={13} /></a> : <em key={source.label}>{source.label}</em>)}</div> : null}
        </section>

        {warnings.length > 0 && <details className="data-warning"><summary><AlertTriangle size={16} />{warnings.length} 条数据警告</summary><ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details>}

        <section className="toolbar" aria-label="搜索和排序">
          <label className="search-box"><Search size={22} /><span className="sr-only">搜索论文</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、作者、机构、会议、年份、方向或速读内容…" /></label>
          <button className="mobile-filter-button" onClick={() => setFilterOpen(true)}><SlidersHorizontal size={18} />筛选{activeFilterCount(filters) > 0 && <b>{activeFilterCount(filters)}</b>}</button>
          <label className="sort-box"><span>排序</span><select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>{sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        </section>
        {sort === "relevance" && !query.trim() && <p className="sort-hint">输入搜索词后按相关度排序；当前使用推荐顺序。</p>}
        <FilterChips filters={filters} onChange={setFilters} onReset={() => setFilters(emptyFilters)} />

        <div className="workspace">
          <aside className="desktop-filters"><FilterPanel dataset={dataset} searchable={searchablePapers} filters={filters} userState={userState} onChange={setFilters} onReset={() => setFilters(emptyFilters)} /></aside>
          <section className="paper-results" aria-labelledby="results-title">
            <div className="results-heading">
              <h2 id="results-title">全部论文</h2>
              <p>找到 <b>{sortedPapers.length}</b> 篇{query.trim() && <>与“{query.trim()}”相关的论文</>}</p>
            </div>
            {visiblePapers.length ? (
              <>
                <div className="paper-grid">
                  {visiblePapers.map((paper) => <PaperCard key={paper.id} paper={paper} dataset={dataset} state={userState[paper.id] ?? {}} comparing={compareIds.includes(paper.id)} onOpen={() => setSelectedId(paper.id)} onFavorite={() => toggleFavorite(paper.id)} onStatus={() => cycleStatus(paper.id)} onCompare={() => toggleCompare(paper.id)} />)}
                </div>
                {visibleCount < sortedPapers.length && <div className="load-more" ref={loadMoreRef}><button className="button outline" onClick={() => setVisibleCount((count) => Math.min(count + PAGE_SIZE, sortedPapers.length))}>加载更多论文</button><span>已展示 {visiblePapers.length} / {sortedPapers.length}</span></div>}
              </>
            ) : <EmptyResults hasFilters={Boolean(query.trim()) || activeFilterCount(filters) > 0} onReset={resetAll} />}
          </section>
        </div>
      </main>

      <ModalFrame open={filterOpen} onOpenChange={setFilterOpen} title="筛选论文" description={`${activeFilterCount(filters)} 个条件`} className="mobile-filter-dialog"><FilterPanel dataset={dataset} searchable={searchablePapers} filters={filters} userState={userState} onChange={setFilters} onReset={() => setFilters(emptyFilters)} /></ModalFrame>
      <DetailDrawer paper={selectedPaper} dataset={dataset} open={Boolean(selectedPaper)} state={selectedPaper ? userState[selectedPaper.id] ?? {} : {}} comparing={selectedPaper ? compareIds.includes(selectedPaper.id) : false} saved={saved} onOpenChange={(open) => { if (!open) setSelectedId(null); }} onPatch={(patch) => selectedPaper && patchState(selectedPaper.id, patch)} onCompare={() => selectedPaper && toggleCompare(selectedPaper.id)} />
      <FavoritesDialog open={favoritesOpen} onOpenChange={setFavoritesOpen} papers={favoritePapers} dataset={dataset} userState={userState} onOpenPaper={(paper) => { setFavoritesOpen(false); setSelectedId(paper.id); }} />
      <CompareDialog open={compareOpen} onOpenChange={setCompareOpen} papers={comparePapers} />
      <ComparisonTray papers={comparePapers} onRemove={toggleCompare} onOpen={() => setCompareOpen(true)} />
      <div className="toast" role="status" aria-live="polite">{notice}</div>
    </div>
  );
}

export default App;
