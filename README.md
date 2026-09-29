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
3. 覆盖 `public/data/papers.json` 后刷新页面。请求使用 `cache: no-store`，无需改动应用代码。

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

因此同一 `datasetId` 更新论文数据时会保留个人状态；更换 `datasetId` 会自动使用独立空间。网站没有数据库、后端 API、账号系统或跨设备同步。

## 数据与隐私

仓库当前收录 12 篇真实开放论文。论文公开元数据来自 arXiv 及会议官方页面，官方、PDF、评审、项目与代码链接只在数据提供且 URL 有效时显示。搜索、筛选、排序、收藏、导出与对比都在浏览器本地完成。

## 质量检查

生产构建与测试配置相互隔离。发布前可运行 `npm run check`，依次执行生产构建、测试类型检查和自动化测试；Vercel 的 `npm run build` 只处理生产源码。
