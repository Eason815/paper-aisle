# 个人阅读记录云端同步

适用于 Paper Aisle 的 React/Vite 网站。公共论文继续使用 GitHub—Vercel 发布；云端仅保存个人收藏、收藏时间、四种阅读状态、标签和便签。默认功能关闭，配置缺失时继续本地模式。不开公开注册，不提供网页管理密钥入口。

## 上线配置

1. 在自己的 Supabase 账号建立专用 Free 项目，地区默认 Singapore。数据库密码由本人设置并保管。先完成账号连接和真实手机网络测试，再决定正式启用。
2. 通过 Supabase migration 工具或 SQL Editor 执行 `supabase/migrations/20261027090659_reading_sync.sql` 一次。默认没有允许账号，因此没有读写权限。迁移中的 private 表不向浏览器开放。
3. 在 Authentication → Users 创建个人邮箱账号，使用本人设置的密码并确认邮箱；在 Auth 配置关闭“Allow new users to sign up”，不启用匿名登录。不要将密码写进仓库、聊天、公共 JSON 或 shell 命令历史。第一版不依赖邮件，忘记密码由本人在管理端恢复。不要全局关闭邮箱验证来替代单个账号确认。
4. 在 SQL Editor 将个人账号 UUID 加入允许名单。只替换 UUID，不使用邮箱作为前端权限判断：

   ```sql
   insert into private.paper_aisle_allowed_users(user_id)
   values ('替换为 Authentication 中个人账号的 UUID')
   on conflict do nothing;
   ```

5. 从项目 Connect/API Keys 取得项目 URL 和 **publishable** key（`sb_publishable_` 开头）。在本机 `.env.local` 或 Vercel Preview 环境设置 `.env.example` 中的三个变量。前端不接受 secret、service-role 或旧 JWT key；构建时检测到错误类型会失败，且不回显值。
6. 首先只在 Preview 设置 `VITE_ENABLE_CLOUD_SYNC=true`，Production 继续 false/不配置。只使用合成阅读记录测试；登录密码由本人在界面输入。Preview 设置 `VITE_CLOUD_SYNC_NAMESPACE=preview`，同步和账号缓存使用独立的 `datasetId::preview`；Production 此项留空，继续使用原 datasetId。公共论文和个人备份的 datasetId 不变。
7. 执行本文末尾的真实验收。通过后在 Vercel Production 设置相同项目 URL、publishable key，启用 flag 并重新部署。没有完成真实设备验收时，不报告云端上线成功。

环境变量变动需重新构建部署。`.env*` 已忽略，只有 `.env.example` 可提交。

## 数据契约与权限

- `paper_reading_records`：联合主键 `user_id,dataset_id,paper_id`，JSON `data`、递增 `revision`、服务器 `updated_at`。data 支持 favorite、favoritedAt、readingStatus、tags、note；不存公共论文内容、密码或管理密钥。
- `paper_aisle_sync_access()`：登录账号是否在管理端维护的允许名单中。
- `paper_aisle_write_record(dataset,paper,data,expected_revision)`：原子比较版本后写入，调用者身份来自 auth.uid()，不接受客户端 user_id。版本不同返回冲突及当前服务器记录，不覆盖。
- 匿名无法访问记录或写入 RPC；未获准的登录账号也无法读写；authenticated 仅有受 RLS 约束的 SELECT 权限，没有直接 INSERT/UPDATE/DELETE 或修改 revision 的权限。
- 不从网站删除云端记录。取消收藏、清空便签及标签通过显式 false/空字符串/空数组同步。

## 浏览器行为

- 邮箱密码仅用于登录，持久会话和刷新由 Supabase SDK 管理；不开放注册入口。会话失效后重新登录，同账号待上传缓存仍保留。
- 统一记录入口覆盖卡片、详情、收藏、备份恢复和浏览器工具。编辑立即保存本机；停止编辑约1秒后上传，网络失败等待重试。页面前台每30秒以及 focus、visible、online 事件检查同步。
- 账号缓存以 userId 和 datasetId 隔离。同步队列和冲突也落盘，刷新后不会丢失。上传期间的新编辑保留并在下一轮上传。成功响应丢失后，通过服务器版本和值确认，无须重复新增。
- 旧浏览器记录默认不上传；登录后先展示迁移预览。确认后按已选偏好处理状态与收藏，标签合并，不同便签并列保留。原记录不删除，重复导入不会重复叠加便签。
- 登录后原匿名记录标记为私人旧记录，退出不再向匿名界面自动显示；原文件仍可作为迁移来源。退出前若有待上传或本机保存失败，需要先同步或导出备份，随后清除该账号缓存。浏览器存储不是对同一设备使用者的加密隔离。
- 冲突在账号面板展示本机和云端两份，可选本机、云端，或编辑合并便签并选择其他字段采用哪个版本；未处理不自动覆盖。
- JSON 完整备份和 Markdown 导出继续有效。云端不会替代独立备份。

手机固定使用同一浏览器和正式网址；iPhone Safari 分享菜单 → 添加到主屏幕，Android 浏览器菜单 → 添加到主屏幕（具体名称以浏览器为准）。这只提供入口，不承诺完整离线网页或 PDF 缓存。

## 验收与运行

本地 `npm run check` 包括实际迁移的 PGlite SQL 角色/RLS/RPC 测试、两设备同步模型、断网重载、丢响应、并发修改、旧数据迁移和账号退出测试。它不等同于真实 Supabase 托管项目与手机验收。

真实项目待检查：

- owner 账号在电脑、手机均能登录，重开页面恢复会话；两端更改记录后切回页面5秒内完成一次正常同步。
- 原匿名记录未经确认不上云，确认后迁移，旧 JSON 导入仍先预览。
- 匿名、第二个测试账号及篡改 user_id 的请求均不能读写记录。第二账号不加入允许名单。
- 手机断网编辑并刷新后仍保留，恢复网络上传；两端同时改便签出现冲突，处理后两端一致。
- 同步错误时公共论文仍可浏览，错误提示不输出凭证或笔记内容。

免费项目可能因低活跃暂停。恢复项目后重试，暂停期间保持本地记录；不通过无意义请求规避平台规则。开启真实同步前应测试本人手机实际网络，不能根据本机连通代替手机验收。

回退：停用前导出完整备份，设 `VITE_ENABLE_CLOUD_SYNC=false` 后重新部署。公共论文和匿名本地模式继续可用；账号缓存、旧记录和云端表不删除，重新启用并登录相同账号后可继续。停用状态不自动向匿名界面展示账号缓存。

## 已建立的真实项目（2026-10-27）

- 项目：paper-aisle；project ref：mduvrwxfmcnuuyewlujf；组织 Eason815's Org；Singapore；创建报价 $0/月。
- 托管数据库迁移实际版本为 20261027090659，仓库文件名已与服务端历史对齐。不要重复执行初始迁移。
- 真实 SQL 角色检查已确认匿名与未获准账号的读取、写入及允许名单修改被阻止；账号配置时阅读记录为空；允许名单仅包含一个已确认的个人账号。后续合成验收记录仅保存在preview范围。已通过该账号的数据库角色验证首次写入和旧版本冲突拒绝，合成测试事务已回滚。
- Security advisors 没有 WARNING/ERROR；唯一 INFO 为私人允许名单没有 RLS policy，这是有意的默认拒绝，保持管理端维护，不添加开放策略。[检查说明](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)。Performance advisors 无提示。
- 用户明确从空记录开始，不需要旧记录迁移。个人账号及允许名单已配置，公开注册和匿名登录均已关闭。Vercel Preview四项公开配置已保存，namespace为preview；预览部署已READY，测试地址：https://paper-aisle-pkf4gk3ei-eason815s-projects.vercel.app/。线上账号入口、本人真实登录、合成记录上传和刷新恢复均已核验；真实手机、重启浏览器、断网和冲突验收仍待完成。用户于2026-10-27明确调整为先启用正式网址、再由本人完成设备验收。Production已启用，正式部署7JNr32DzMeDQL6rhBPXdRzzBG7Jv为READY；https://paper-aisle.vercel.app/已核验可直接访问并显示邮箱密码登录入口。真实正式账号登录、手机、断网和冲突检查由本人继续验收。


2026-10-27实施顺序例外：原上线步骤中的手机验收前置条件已由用户明确调整为正式启用后验收，目的是避免预览网址的Vercel登录。该调整不表示设备验收通过。后续更新按实际完成情况维护验收文档。
