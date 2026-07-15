# 多推广网站与已验证外链资源库设计

## 背景

当前项目已经支持批量提交、半自动页面助手、提交结果存档和外链状态检测。现有配置主要围绕单个推广网址展开，批量工作台也主要从浏览器配置中读取一个 `promotion_website_url`。`load-this-extension` 目录中已有 `link-assistant-settings.*` 和 `resource-library.*` 的前端雏形，说明半自动助手方向已经开始设计“推广项目”和“资源库”，但源目录中还没有正式的后端 API、MySQL 表和共享数据模型。

本次功能要把自动、半自动、手动三种模式统一到同一套推广网站配置和外链资源库上，支持用户维护多个推广网站，但一个浏览器实例同一时间只推广一个网站。外链资源库只收录外链检测成功的资源，避免把未确认或失败资源混入正式库。

## 已确认决策

- 使用“多推广网站配置库 + 当前浏览器只激活一个推广网站”的方案。
- 当前浏览器选择的推广网站 ID 保存在浏览器本地状态中，不新增 MySQL 浏览器会话表。
- 所有提交记录、检测结果和正式资源库记录都写入 MySQL，并绑定 `promotion_project_id`。
- 资源库只收录外链检测成功的记录。提交后未检测、检测失败、待人工确认的记录只保留在提交记录或存档中。
- 同一个 `Source url` 可以服务多个推广网站。数据模型拆分为“资源页面”和“已验证外链关系”，避免一对多场景混乱。
- 用户需要同时推广多个网站时，打开另一个浏览器或独立 Profile，并在该浏览器中选择另一个当前推广网站。

## 目标

- 支持维护多个推广网站配置。
- 每个推广网站支持 `推广网址`、`关键字`、`title`、`description`、`H1`。
- 用户填写推广网址后，由本地后端抓取页面并自动填充 `title`、`description`、`H1` 和可用关键字。
- 自动、半自动、手动模式共用同一套当前推广网站配置。
- 自动、半自动、手动模式共用同一套提交记录和外链资源库。
- 外链检测成功后，把对应资源写入正式外链资源库。
- 资源库导出字段参考 Semrush 导入文件模板，并补充序号、目标域名、目标域名权重占位、目标域名流量占位、资源发现来源。
- UI 保持简单、分区清楚、步骤少，避免把配置、提交记录、资源库混在一起。

## URL 字段命名约定

本功能中会同时出现本系统的目标网址和 Semrush CSV 的目标网址，必须明确区分：

- `target_url` / 推广网址：系统内部字段，始终表示我们的推广网址，也就是 `promotion_projects.target_url`。
- `Target url`：在 Semrush 兼容 CSV 导入和导出文件中遵循 Semrush 语义。导入时它是 Semrush 原始 `Target url`；资源库以 Semrush 兼容格式导出时，它也必须填写发现来源，而不是我们的推广网址。
- `Source url`：外链提交地址，也就是产生外链的资源页面。
- `Discovery target url`：资源发现来源，取自导入 Semrush CSV 文件里的原始 `Target url`。它表示这条 `Source url` 最初是从哪个 Semrush 目标页面或竞品外链记录中发现的，不参与反链检测目标匹配。

实现和 UI 文案中不得把内部推广网址简写成 Semrush CSV 的 `Target url`。当需要展示我们的推广网址时，使用“推广网址”或 `target_url`；当需要展示 Semrush 来源时，使用 `Discovery target url`。

同一个 `Source url` 可能从多个 Semrush CSV 原始 `Target url` 中被发现，因此资源页本身需要保存发现来源列表。正式导出行上的 `Discovery target url` 优先使用对应成功关系的来源；如果成功关系没有记录，则回退到资源页的首次发现来源。

## 非目标

- 不新增云端账号、浏览器实例管理或远程调度中心。
- 不保存账号、密码、cookie、token、私有带密钥 URL 等敏感信息。
- 不在第一版计算目标域名权重和流量，只保留占位字段。
- 不把检测失败或未确认资源写入正式资源库。
- 不把同一个浏览器设计成同时并行推广多个网站。

## 核心架构

系统分为四层：

1. 推广网站配置库：MySQL 中的 `promotion_projects`。
2. 当前浏览器上下文：浏览器本地保存 `current_promotion_project_id`。
3. 提交记录：MySQL 中的 `submission_records`，记录自动、半自动、手动产生的所有尝试。
4. 已验证资源库：`resource_pages` 记录资源页本身，`verified_backlinks` 记录某个资源页对某个推广网站的成功外链关系。

自动批量、半自动助手、手动添加都通过同一组后端 API 读取当前推广项目并写入提交记录。外链检测器只在检测到 `Source url` 页面中存在指向当前 `Target url` 的链接时，才写入或更新正式资源库。

## 推广网站数据模型

`promotion_projects` 保存多个推广网站配置。

建议字段：

- `id`
- `target_url`：推广网址。
- `target_domain`：从 `target_url` 自动提取的域名，用于筛选、去重、导出和后续权重/流量补充。
- `keywords_json`：多个关键字，同时作为 AI 生成评论时的候选锚文本来源。
- `page_title`
- `meta_description`：同时承担产品描述用途。
- `h1`
- `contact_email`：用于表单自动填充。如果未来确认不需要，可再弱化。
- `default_submit_mode`：`manual`、`confirm`、`auto`。
- `fetch_status`：`success`、`failed`、`manual`。
- `fetch_error`：抓取失败的简短错误码或消息。
- `fetched_at`
- `created_at`
- `updated_at`

正式模型不再保存 `product_name`、`default_anchor_text`、单独的 `product_description`。旧字段兼容规则：

- 旧 `defaultAnchorText` 迁移或合并到 `keywords_json`。
- 旧 `productDescription` 迁移到 `meta_description`。
- 旧 `productName` 不作为正式字段保存；项目列表显示名优先使用 `target_domain`，必要时用 `target_url`。

## 提交与资源库数据模型

`submission_records` 保存所有提交尝试。

关键字段：

- `id`
- `promotion_project_id`
- `target_url`
- `target_domain`
- `source_url`
- `source_url_key`
- `source_domain`
- `discovery_target_url`：可选，来自 Semrush CSV 原始 `Target url`，用于记录这条资源从哪里发现。
- `mode`：`batch`、`assistant`、`manual`。
- `submit_mode`：`manual`、`confirm`、`auto`。
- `result`：沿用现有成功、待确认、失败、需手动处理等状态。
- `ai_content_summary`
- `error_message`
- `batch_id`
- `latest_backlink_status`
- `latest_backlink_checked_at`
- `latest_backlink_matched_href`
- `latest_backlink_reason`
- `resource_library_sync_status`
- `created_at`
- `updated_at`

`resource_pages` 保存资源页面本身，一条 `Source url` 只保存一条。

关键字段：

- `id`
- `source_url`
- `source_url_key`：唯一。
- `source_domain`
- `first_discovery_target_url`：第一次发现该资源页时，Semrush CSV 原始行里的 `Target url`。
- `last_discovery_target_url`：最近一次导入或更新该资源页时，Semrush CSV 原始行里的 `Target url`。
- `discovery_target_urls_json`：该资源页所有去重后的发现来源列表。
- `source_title`
- `resource_type`
- `quality_label`
- `topic_tags_json`
- `notes`
- `page_ascore`
- `external_links`
- `last_seen`
- `created_at`
- `updated_at`

`verified_backlinks` 保存正式外链资源库中的成功关系。

关键字段：

- `id`
- `resource_page_id`
- `promotion_project_id`
- `target_url`
- `target_domain`
- `target_domain_authority`：第一版占位为空。
- `target_domain_traffic`：第一版占位为空。
- `discovery_target_url`：可选，继承自提交记录或 Semrush 导入行的原始 `Target url`。
- `matched_href`
- `first_verified_at`
- `last_verified_at`
- `backlink_status`
- `source_url_key`
- `created_at`
- `updated_at`

唯一约束：

- `resource_pages.source_url_key` 唯一。
- `verified_backlinks(source_url_key, promotion_project_id)` 唯一。

这样同一个 `Source url` 可以对应多个不同推广网站；同一个 `Source url` 对同一个推广网站重复检测成功时，只更新 `last_verified_at` 和检测字段，不新增重复关系。

重复导入规则：

- 如果 `source_url_key` 不存在，新增 `resource_pages`，并设置首次和最近发现来源。
- 如果 `source_url_key` 已存在，不停止导入；更新 `last_discovery_target_url`，并把新的 `Discovery target url` 去重加入 `discovery_target_urls_json`。
- 如果 `source_url_key + promotion_project_id` 已经验证成功过，不新增重复 `verified_backlinks`，只更新 `last_verified_at`、检测状态和来源信息。
- 如果同一个 `source_url_key` 对另一个推广网站检测成功，新增新的 `verified_backlinks` 关系。

## 页面抓取与自动填充

用户输入推广网址后，扩展调用本地后端 API。后端负责：

- 校验 URL 协议，仅允许 `http` 和 `https`。
- 设置超时，避免页面抓取卡死。
- 抓取 HTML，不记录敏感 query。
- 解析 `title`、`meta[name=description]`、第一个 `h1`、`meta[name=keywords]`。
- 返回结构化结果给前端。

抓取成功后前端自动填充字段，用户仍可修改。抓取失败不阻止保存，表单显示失败原因并允许用户手动填写。

## 工作流

### 推广网站管理

升级现有 `link-assistant-settings` 页面为正式推广网站管理页。

- 左侧显示推广网站列表。
- 右侧编辑当前推广网站。
- 用户新建或选择网站后，可输入推广网址并自动获取页面信息。
- 保存成功后，该浏览器本地写入 `current_promotion_project_id`。
- 顶部或状态区清楚显示“当前浏览器正在推广：目标域名”。

### 批量工作台

批量工作台不再直接读取旧单个 `promotion_website_url` 作为唯一来源，而是读取当前推广项目。

- 启动前必须存在当前推广项目。
- 工作台顶部显示当前推广网站、目标域名和关键字摘要。
- 用户可从工作台跳转到推广网站管理页切换当前项目。
- 每条 URL 的提交结果写入 `submission_records`。
- Semrush CSV 导入产生的提交任务需要把原始 `Target url` 写入 `discovery_target_url`，不能覆盖当前推广项目的 `target_url`。
- 现有前端实时进度、当前批次表格、存档体验保留。
- 存档筛选改为优先按 `promotion_project_id` 和 `target_domain`。

### 半自动与手动助手

浮动助手读取当前推广项目。

- 生成评论时使用当前页面内容、推广网站 `title`、`description`、`H1` 和 `keywords`。
- 锚文本从 `keywords` 中选择最适合当前页面语境的一项。
- 如果当前页面对当前推广项目已经有成功外链，默认提示并阻止重复提交。
- 用户可以手动覆盖重复限制。
- 手动“加入资源库”会先创建或更新资源页面和提交记录，但检测成功前不进入 `verified_backlinks`。

### 外链检测成功入库

检测器确认 `source_url` 中存在指向 `target_url` 的链接后：

1. 更新 `submission_records.latest_backlink_status = success`。
2. upsert `resource_pages`。
3. upsert `verified_backlinks`。
4. 写入同步状态和诊断日志。

检测失败、超时或未发现链接时，只更新提交记录，不进入正式资源库。

## 资源库导出

资源库导出来源是 `verified_backlinks`，只导出已验证成功关系。导出分为两种模式：

1. Semrush 兼容导出：默认导出模式，目标是让导出的 CSV 可以直接作为 Semrush CSV 再导入，用于推广另一个网站。
2. 管理导出：可选导出模式，目标是给用户查看和审计内部字段，允许包含推广项目、检测时间、验证状态等额外列。

Semrush 兼容导出必须使用与导入时一致的字段语义：

- `Source url`：外链提交地址，也就是 `resource_pages.source_url`。
- `Target url`：发现来源，取自 Semrush CSV 原始 `Target url`，不能使用我们的推广网址。
- `Page ascore`
- `Source title`
- `External links`
- `Last seen`

Semrush 兼容导出的 `Target url` 取值规则：

- 默认取 `resource_pages.first_discovery_target_url`。
- 如果导出时用户选择了某个发现来源，则只导出包含该发现来源的资源行，并把该列统一填为用户选择的发现来源。
- 如果某条资源缺少发现来源，Semrush 兼容导出中默认跳过该行，避免生成无法说明来源的 `Target url`。

管理导出可以包含完整内部字段：

- `#`
- `Promotion target url`：我们的推广网址。
- `Promotion target domain`
- `Target domain authority`：第一版占位为空。
- `Target domain traffic`：第一版占位为空。
- `Source url`
- `Source domain`
- `Discovery target url`
- `All discovery target urls`
- `Page ascore`
- `Source title`
- `External links`
- `Last seen`
- `First verified at`
- `Last verified at`
- `Backlink status`
- `Promotion keywords`
- `Page title`
- `Description`
- `H1`

这样默认导出可以直接再导入，管理导出则保留我们的推广网站和检测状态，避免把两种用途塞进同一套列名。

## UI 设计原则

本功能属于运营型工具，不做营销页式布局。界面应安静、清晰、可扫描。

通用原则：

- 少步骤：常用路径不超过“选择当前网站 - 上传或打开页面 - 提交/检测 - 查看结果”。
- 分区清楚：推广网站配置、提交存档、正式资源库分别呈现，不混在一个表里。
- 当前上下文明显：所有自动、半自动、手动入口都显示当前推广网站。
- 状态可见：保存、抓取、检测、入库、导出都有明确 loading、success、error 状态。
- 表格稳定：资源库和存档表格使用横向滚动或固定关键列，避免小屏溢出破坏布局。
- 操作按钮少而明确：主按钮只保留当前步骤最需要的动作，辅助动作放在次级按钮或工具栏。
- 不使用过度装饰、渐变背景或大面积卡片堆叠。
- 保持现有扩展风格，优先复用当前按钮、表格、筛选器和状态条样式。

页面建议：

- 推广网站管理页：左侧列表，右侧表单。表单按“网址与抓取信息”“关键字”“提交设置”分组。
- 批量工作台：顶部新增当前推广网站条，提供“切换网站”入口；上传区和结果区保持现有结构。
- 半自动助手：只显示当前网站摘要、生成内容、提交动作和资源状态，不塞完整配置表。
- 资源库页：默认显示已验证外链关系；筛选栏按推广网站、Source domain、发现来源、资源类型、质量和关键词排列。导出区默认提供“Semrush 兼容 CSV”，并允许用户选择发现来源；未选择时使用每条资源的首次发现来源。

## API 边界

建议新增或正式补齐 `api/link-assistant.js`，并挂载到 `/api/link-assistant`。

接口范围：

- `GET /link-assistant/projects`
- `POST /link-assistant/projects`
- `PATCH /link-assistant/projects/:id`
- `DELETE /link-assistant/projects/:id`
- `POST /link-assistant/projects/fetch-metadata`
- `GET /link-assistant/resources`
- `PATCH /link-assistant/resources/:id`
- `DELETE /link-assistant/resources/:id`
- `GET /link-assistant/export.csv`：默认 Semrush 兼容导出，可用 `format=management` 切换管理导出，可用发现来源参数筛选和指定 Semrush CSV 的 `Target url`。
- `POST /link-assistant/submissions`
- `POST /link-assistant/submissions/:id/backlink-check-result`

前端页面可以继续使用已有的 `LINK_ASSISTANT_API_REQUEST` 桥接思路，但源目录需要补齐 background 桥接和后端实现，避免 `load-this-extension` 中的页面只有前端壳。

## 兼容与迁移

- 保留旧 `promotion_website_url` 读取能力，首次发现旧配置但没有推广项目时，自动创建一个推广项目。
- 旧 `promotion_website_content` 可迁移为 `meta_description`。
- 旧默认锚文本迁移到 `keywords_json`。
- 批量提交仍可先保留现有 `chrome.storage` 实时结果，用 MySQL 作为长期提交记录来源。
- `load-this-extension` 中已有 `link-assistant-settings` 和 `resource-library` 页面要并入 `autoComment` 源目录，再同步到 `dist` 和加载目录。

## 日志与安全

新增日志前缀：

- `[link-assistant][project]`
- `[link-assistant][metadata]`
- `[link-assistant][submission]`
- `[link-assistant][resource-library]`

日志记录：

- 操作名。
- 非敏感 ID。
- 域名。
- 状态变化。
- 数量。
- 耗时。
- 错误码和脱敏错误消息。

日志不得记录：

- 密码、cookie、token、API key。
- 带敏感 query 的完整 URL。
- 原始账号凭据。
- 过长页面正文或完整敏感 payload。

## 错误处理

- 推广网址无效：表单阻止保存，提示 URL 协议或格式错误。
- 元信息抓取失败：允许保存，字段由用户手动填写。
- 当前浏览器未选择推广网站：自动、半自动、手动入口都阻止开始，并提供去配置页的入口。
- 提交记录保存失败：前端显示失败并写诊断日志，不静默吞掉。
- 检测成功但资源库同步失败：提交记录保留成功检测状态，并标记 `resource_library_sync_status = failed`，允许后续重试。
- 重复成功关系：更新已有关系，不新增重复行。
- 重复资源页导入：不停止导入，更新该资源页的最近发现来源和发现来源列表。
- 同一资源页对其他推广网站成功：新增新的 `verified_backlinks` 关系。

## 测试计划

自动化测试：

- 推广网址规范化与目标域名提取。
- 多关键字解析、去重和旧默认锚文本迁移。
- description 与旧产品描述兼容。
- 后端元信息解析成功和失败路径。
- 当前推广项目缺失时，批量和助手入口阻止开始。
- 提交记录绑定 `promotion_project_id`。
- 检测成功才创建 `verified_backlinks`。
- 同一 `source_url_key + promotion_project_id` 重复成功只更新。
- 同一 `source_url_key` 对不同 `promotion_project_id` 可创建多条关系。
- Semrush 兼容导出字段和现有 Semrush CSV 导入字段一致，导出的文件可以被当前 Semrush CSV 导入逻辑重新导入。
- Semrush 兼容导出的 `Source url` 是外链提交地址，`Target url` 是发现来源，不是我们的推广网址。
- 未选择发现来源时，Semrush 兼容导出默认使用 `first_discovery_target_url` 作为 `Target url`。
- 用户选择某个发现来源导出时，只导出包含该发现来源的资源行，并把 Semrush CSV 的 `Target url` 写成用户选择的发现来源。
- 管理导出使用 `Promotion target url` 表示我们的推广网址，避免和 Semrush CSV 的 `Target url` 混淆。
- 重复导入同一个 `Source url` 时不会停止导入，并会维护 `first_discovery_target_url`、`last_discovery_target_url` 和 `discovery_target_urls_json`。
- 旧配置首次迁移为推广项目。

手动验收：

- 新建推广网站，输入 URL 后自动填充 title、description、H1、keywords。
- 修改字段并保存后，当前浏览器显示该推广网站为当前项目。
- 开另一个浏览器或 Profile，可以选择另一个推广网站。
- 批量工作台启动前显示当前推广网站。
- 半自动助手生成内容时使用当前项目关键字作为锚文本候选。
- 手动添加资源后，检测成功前不出现在正式资源库。
- 外链检测成功后，资源库出现对应记录。
- 同一个 Source url 分别对两个推广网站检测成功后，资源库显示两条关系。
- 资源库 CSV 导出内容可被表格软件打开且列名正确。
- 从 Semrush CSV 导入的资源在检测成功后，资源库行能显示原始 `Discovery target url`。
- 资源库默认导出的 Semrush 兼容 CSV 可以再次导入，用于另一个推广网站。
- 在资源库导出时选择其他发现来源后，导出文件里的 `Target url` 使用用户选择的发现来源。
- 重复导入同一个 Source url 且 Semrush 原始 Target url 不同时，资源页能保留多个发现来源。

## 验收标准

- 用户可以维护多个推广网站配置。
- 每个推广网站可以自动抓取并手动修改 title、description、H1、关键字。
- 当前浏览器一次只激活一个推广网站。
- 自动、半自动、手动模式共用当前推广网站配置。
- 所有提交记录写入 MySQL，并绑定推广项目。
- 外链检测成功后才进入正式外链资源库。
- 同一 Source url 支持多个推广网站成功关系。
- 资源库默认导出 Semrush 兼容 CSV，并可被本系统 Semrush 导入功能再次导入。
- Semrush 兼容导出中的 `Target url` 表示发现来源；管理导出中的 `Promotion target url` 表示我们的推广网址。
- 重复外链资源导入采用更新策略，不中断导入任务。
- UI 分区清楚、状态明确、操作步骤少。
- 不保存或记录敏感凭据。
