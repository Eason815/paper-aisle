# Paper Aisle

Paper Aisle 是一个数据驱动的单页论文调研工作台。库名、简介、统计、筛选、配色、卡片和详情都由 `public/data/papers.json` 提供；应用本身不假设会议、年份、研究领域或论文数量。

## 本地运行

```powershell
npm install
npm run dev
```

生产验证：

```powershell
npm test
npm run build
npm run preview
```

构建产物位于 `dist/`，可以托管在任意静态服务器。页面通过 Vite 的 base-aware URL 加载 `data/papers.json`，适用于域名根路径和子路径部署。

## 替换论文数据

1. 按照 [`public/data/papers.schema.json`](public/data/papers.schema.json) 准备 JSON。
2. 保留 `schemaVersion: 1`，并设置稳定、唯一的 `datasetId`。
3. 本地替换 `public/data/papers.json` 后刷新页面。请求使用 `cache: no-store`。更新线上数据时，提交到 GitHub，由 Vercel 重新构建部署；不需要修改应用代码。

根级最小示例：

```json
{
  "schemaVersion": 1,
  "datasetId": "my-library-v1",
  "library": { "name": "我的论文库" },
  "config": { "directions": [], "presentationTypes": [] },
  "papers": [
    { "id": "paper-001", "title": "A paper title" }
  ]
}
```

只有论文的 `id` 和 `title` 是必填字段。空的可选内容不会出现在界面中；无效外链会被丢弃。无效论文或重复 ID 会被跳过并生成非阻塞警告，根结构或网络错误会进入可重试的错误状态。

`config.directions` 决定侧栏展示的核心方向及顺序；每篇论文通过单一 `direction` 归入其中一个方向，`subdirection` 仍可用于搜索和详情展示，但不会占用侧栏空间。`config.categoryColors` 可以按核心方向指定任意合法 CSS 颜色；未指定的方向会根据名称生成稳定的 OKLCH 颜色。

会议展示形式使用论文级 `presentationType`（如 `Oral`、`Spotlight`、`Highlight`、`Poster`），其筛选与排序顺序由 `config.presentationTypes` 决定。旧版 `displayLevel` / `displayLevels` 仍会兼容读取，但会产生迁移提示。

`config.notableInstitutions` 配置大厂、顶校和研究机构的规范名、类型及别名。作者的 `affiliations` 命中其中任意名称后，论文会进入“大厂 / 顶校团队”筛选。是否有公开代码则直接根据有效的 `links.code` 判断。

## 个人数据

收藏、收藏时间、阅读状态、标签和便签保存在浏览器：

```text
paper-aisle:${datasetId}:user-state:v1
```

因此同一 `datasetId` 更新论文数据时会保留个人状态；更换 `datasetId` 会自动使用独立空间。默认使用本地模式；可按[云端同步配置说明](docs/cloud-sync.md)接入 Supabase，启用个人账号与跨设备同步。未配置或关闭功能开关时不启动云端连接。

## 数据与隐私

仓库保留原有基础阅读数据，并接入首批 Agent 调研数据。论文公开元数据来自 arXiv 及会议官方页面，官方、PDF、评审、项目与代码链接只在数据提供且 URL 有效时显示。搜索、筛选、排序、导出与对比在浏览器本地完成。启用并登录云端账号后，收藏、阅读状态、标签和便签会同步到账号的私人记录表；原匿名记录需迁移预览与确认才会上云。

## 调研集合与图解导读

根级 `collections` 和 `config.defaultCollectionId` 保留为后台批次元数据；页面默认展示调研论文，基础论文通过筛选开关显示，不再提供批次切换区。`questionCatalog` 定义研究问题，论文以 `questionId` 关联，仍可搜索和筛选。

论文可选 `scenarios` 和 `readingGuide`。导读包含中文概述、论文类型、材料深度、来源，以及可选的概念图；图示模块的数据和说明均由 JSON 提供。界面支持方法、分析和成对评测三种布局。摘要级概念图明确标记材料范围，不作为原论文算法图。

详情在缺少完整 `method` / `findings` 时回退显示 `quickRead`，并支持在本次打开的阅读序列中前后翻篇。正文内的 J/K 可切换下一篇/上一篇；输入框内不触发快捷键。便签可插入阅读模板，原内容会保留。

## 批次数据接入

后续批量制作论文使用 [`docs/ingestion/README.md`](docs/ingestion/README.md) 中的标准与主提示词。提示词包包含来源/证据规则、中文导读和图解格式、任务参数、校验与断点续跑指令；默认只生成待入库文件，不自动覆盖公共库或发布。

首批原始调研记录保存在 `data/batches/`，图解及中文概述补充在 `data/guides/`，集合配置位于 `data/research-import.json`。三段速读由调研记录投影，不独立改写。

```powershell
npm run data:preview
npm run data:import
npm run check
```

预览只报告新增、更新、保留及冲突；导入在现有库上增量合并，保留 datasetId 和未涉及的旧论文。遇到 ID/标题冲突会停止。轨道未知或没有人工确认不会阻止有原文依据的候选进入泛读库。再次运行不会重复添加论文。

`data/library.before-round-one.json` 是第一轮前的公开数据快照，供回归检查和恢复公共数据使用，不含浏览器个人记录。实际批次证据和人工状态保存在调研数据中，未伪装为人工已读。

## 阅读记录备份与恢复

页头“阅读记录”支持完整个人状态 JSON 备份、当前集合 Markdown 导出和恢复预览。完整备份带 datasetId，保留不在当前论文列表里的旧记录；不同库的备份不会混入。

恢复不会删除当前已有记录。标签合并，不同便签并列保留；收藏及阅读状态的差异会先展示，用户可选择优先采用当前或备份状态。所有操作在浏览器本地完成，个人备份不要加入公共数据或Git仓库。收藏夹原有 Markdown/BibTeX 导出继续可用，Markdown 现在也包含稳定论文 ID。

## 质量检查

生产构建与测试配置相互隔离。发布前可运行 `npm run check`，依次执行生产构建、测试类型检查和自动化测试；Vercel 的 `npm run build` 只处理生产源码。

## 持续调研

日常入口：[持续调研工作流](docs/ingestion/05-持续调研工作流.md)。`npm run research:status`查看制作进度；`research:validate`校验全部输入；`research:sync`生成问题地图。用户笔记与原始缓存不进入Git或公开数据。

### 阅读视图与状态

基础阅读集合（`background-reading`，12篇）默认从论文列表、检索和分类统计中隐藏，可在筛选中勾选“显示基础论文”恢复；开关仅影响当前页面，不删数据或个人记录。库内总数仍包含基础论文，收藏夹和全部记录导出仍保留它们。

阅读状态为未读（unread）、泛读（skimmed：看过摘要或导读）、在读（reading：正在深入阅读）、已读（read：完成本轮阅读）。既有状态保持原值，备份支持新旧状态。详情中可直接选择，卡片依次切换。默认推荐排序先展示未读论文，其他排序遵循选定规则。阅读状态仅表示个人进度，不代表科研证据核查。

### 跨设备同步部署状态

同步代码默认关闭。真实项目、账号及手机验收进度见[验收清单](docs/cloud-sync-acceptance.md)，不能以本地合成测试替代真实上线验收。云端迁移、允许名单及配置步骤见[配置说明](docs/cloud-sync.md)。
