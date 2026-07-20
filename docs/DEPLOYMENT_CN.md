# BacklinkAssistant 1.0.0 中文部署手册

本文档用于把 BacklinkAssistant 发布给其他人使用。当前版本支持自动批量提交和手动助手两种模式，并共用同一套推广网站、提交记录、历史归档和外链资源库存储逻辑。

## 1. 系统组成

- Chrome 插件：位于 `dist/auto-comment-plugin`，发布给用户时建议打包为 zip。
- 本地后端：Node.js 服务，默认监听 `http://127.0.0.1:3000`。
- MySQL 数据库：默认数据库名 `auto_comment`，用于保存推广网站、批次、提交记录、历史归档和外链资源库。
- AI 模型服务：通过 `.env` 里的 `MODEL_*` 环境变量配置。

当前发布版只支持访问本机后端 `http://127.0.0.1:3000/api`。如果后续要改为远程服务器，不能只修改 `extension-config.js` 里的 `API_BASE`；还必须同步调整 `manifest.json` 里的 `host_permissions`，以及 `background.js` 中对后端地址的安全白名单，然后重新打包插件。

## 2. 环境要求

- Windows 10/11
- Chrome 浏览器
- Node.js 18 或更高版本
- Docker Desktop
- Git

可选：

- PM2：用于服务器常驻运行。
- GitHub CLI：用于创建 GitHub Release。

## 3. 后端部署

进入项目目录：

```powershell
cd autoComment
```

安装依赖：

```powershell
npm install
```

复制环境变量模板：

```powershell
copy .env.example .env
```

编辑 `.env`，至少确认以下配置：

```env
PORT=3000

MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=
MYSQL_DATABASE=auto_comment

MODEL_API_BASE=https://www.packyapi.com/v1
MODEL_WIRE_API=responses
MODEL_CHAT_PATH=/responses
MODEL_NAME=gpt-5.5
MODEL_API_KEY=

ENABLE_PAYMENT=false
```

注意：不要把真实 `MODEL_API_KEY`、支付密钥、数据库密码提交到 GitHub。所有敏感信息只放在本地 `.env`。

启动 MySQL：

```powershell
npm run local:db:start
```

初始化数据库和表：

```powershell
npm run local:db:setup
```

如需初始化本地用户积分，可执行：

```powershell
npm run local:db:setup -- local-user 100
```

启动后端：

```powershell
npm run start
```

验证后端：

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health
Invoke-RestMethod "http://127.0.0.1:3000/api/get-points?userId=local-user"
```

如果想一键启动 Docker、数据库初始化和后端，可以使用：

```powershell
npm run local:stack:start
```

## 4. 插件安装

本仓库发布给其他人时，推荐使用打包目录：

```text
autoComment/dist/auto-comment-plugin
```

如果是在当前开发机器上测试，并且仓库同级存在下面这个目录，也可以加载它：

```text
load-this-extension
```

安装步骤：

1. 打开 Chrome。
2. 访问 `chrome://extensions/`。
3. 打开右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择 `dist/auto-comment-plugin` 目录。
6. 确认插件名称显示为 `BacklinkAssistant`，版本为 `1.0.0`。

如果给别人的是 zip 文件，需要先解压 zip，再加载解压后的目录。

## 5. 基本使用流程

1. 先启动本地后端，确认 3000 端口可访问。
2. 在 Chrome 中加载插件。
3. 点击插件图标进入工作台。
4. 在“推广网站配置”中添加或选择当前推广网站。
5. 自动模式：导入 CSV 或 Semrush CSV，创建批次并启动批量提交。
6. 手动模式：没有批量任务运行时，网页右上角会显示手动助手悬浮入口；点击后可生成并填充内容、提交并记录、检测当前页面外链、加入外链资源库。
7. 历史归档和外链资源库共用同一套存储逻辑，可按推广网站、提交来源等条件维护数据。

## 6. 发布打包

发布包只包含 Chrome 插件文件，不包含 `.env`、数据库、日志和本地调试目录。

推荐打包目录：

```text
autoComment/dist/auto-comment-plugin
```

推荐 zip 文件名：

```text
BacklinkAssistant-1.0.0.zip
```

打包后给其他人使用时，需要同时提供本手册，并提醒对方本地后端和 MySQL 必须先启动。

## 7. Windows 开机自启动

安装自启动任务：

```powershell
npm run local:autostart:install
```

立即启动本地服务：

```powershell
npm run local:stack:start
```

取消自启动：

```powershell
npm run local:autostart:uninstall
```

## 8. 常见问题

### 插件界面打开后没有数据

先确认后端是否启动：

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health
```

再确认插件里的 `API_BASE` 是否仍为：

```text
http://127.0.0.1:3000/api
```

### AI 生成失败

检查 `.env` 中的以下配置是否完整：

```env
MODEL_API_BASE=
MODEL_WIRE_API=
MODEL_CHAT_PATH=
MODEL_NAME=
MODEL_API_KEY=
```

不要在日志、文档或 GitHub 中暴露真实 API Key。

### Chrome 仍显示旧图标或旧名称

进入 `chrome://extensions/`，点击 BacklinkAssistant 的“重新加载”。如果仍不刷新，删除旧插件后重新加载解压目录。

### 数据库连接失败

确认 Docker Desktop 已启动，并检查 `.env` 中的 MySQL 配置：

```env
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=
MYSQL_DATABASE=auto_comment
```

然后重新执行：

```powershell
npm run local:db:start
npm run local:db:setup
```

## 9. 发布前检查清单

- `npm test` 通过。
- `manifest.json`、`dist/auto-comment-plugin/manifest.json` 版本一致。
- `dist/auto-comment-plugin` 中包含 `icons/icon16.png`、`icons/icon32.png`、`icons/icon48.png`、`icons/icon128.png`。
- `.env` 没有被提交。
- 发布 zip 中不包含日志、数据库、调试浏览器用户目录、测试输出或密钥文件。
- Chrome 加载发布目录后，插件名称为 `BacklinkAssistant`，版本为 `1.0.0`。
