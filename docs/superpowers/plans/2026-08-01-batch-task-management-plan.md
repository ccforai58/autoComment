# 批量任务管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让多个已启动批量任务能够独立保存、恢复、继续和删除。

**Architecture:** 使用纯逻辑模块维护任务索引和任务快照选择；`batch.js` 负责 Chrome 本地存储与既有运行时状态的读写；`batch.html` 增加紧凑任务列表，不改动提交内核。

**Tech Stack:** Manifest V3、原生 JavaScript、`node:test`。

## Global Constraints

- 保留 UTF-8；不得保存凭据或原始导入文件内容。
- 每个新行为先写会失败的单元测试。
- 同时只能有一个运行中的批量任务。
- 未执行 URL 不进入反链检测，也不显示为检测失败。

### Task 1: 任务索引纯逻辑

**Files:**
- Create: `lib/batch-task-manager.js`
- Create: `tests/batch-task-manager.test.js`

- [ ] 写入测试，覆盖任务摘要、选择当前项目最新任务、运行任务切换限制和检测目标过滤。
- [ ] 运行 `node --test tests/batch-task-manager.test.js`，确认因模块未实现而失败。
- [ ] 实现最小纯函数并再次运行同一命令。

### Task 2: 运行快照注册

**Files:**
- Modify: `batch.js`
- Test: `tests/legacy-batch-ui.test.js`

- [ ] 写入页面静态接入断言并确认失败。
- [ ] 在每次运行快照写入时更新任务索引和独立快照；启动时迁移旧快照。
- [ ] 保存、暂停、完成和继续后运行针对性测试。

### Task 3: 任务列表与操作

**Files:**
- Modify: `batch.html`
- Modify: `batch.js`
- Test: `tests/legacy-batch-ui.test.js`

- [ ] 写入任务列表容器、选择和删除操作的静态断言并确认失败。
- [ ] 增加紧凑任务列表，选择任务恢复快照，删除非运行任务。
- [ ] 验证暂停 A 后创建 B、再恢复 A 的状态隔离。

### Task 4: 检测范围与回归

**Files:**
- Modify: `batch.js`
- Test: `tests/batch-task-manager.test.js`

- [ ] 写入未执行 URL 排除检测的测试并确认失败。
- [ ] 令外链检测仅接收已有提交结果；无可检测记录时禁用按钮和提示。
- [ ] 运行 `npm test`、`node --check batch.js`，并做一次扩展页面加载检查。
