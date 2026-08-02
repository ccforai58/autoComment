# BacklinkAssistant 1.1.0 部署手册

## 1. 组件与要求

- Chrome 插件发布目录：`dist/auto-comment-plugin`
- 本地后端：Node.js 18+，默认 `http://127.0.0.1:3000`
- 数据库：Docker Desktop 中的 MySQL
- 推荐环境：Windows 10/11、Chrome、Git、Node.js、Docker Desktop

本版本包含：推广网站项目管理、批量和半自动提交、任务草稿/历史、外链检测、资源库、OpenAI 兼容模型配置、随机提交间隔和每日确认阈值。

## 2. 首次安装

在项目根目录执行：

```powershell
npm install
Copy-Item .env.example .env
npm run local:stack:start
```

`local:stack:start` 会启动 Docker、MySQL、初始化表并启动后端。成功后可验证：

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health
```

如只需再次启动已初始化的环境，使用：

```powershell
npm run local:stack:start
```

停止本地服务：

```powershell
npm run local:stack:stop
```

需要 Windows 开机自动启动时：

```powershell
npm run local:autostart:install
```

取消自动启动：

```powershell
npm run local:autostart:uninstall
```

## 3. 模型配置

启动后，从插件首页点击“模型配置”。填写 OpenAI 兼容接口的 API Base、请求模式、路径、模型名和令牌，点击“测试连通性”后保存。

PackyAPI 示例：API Base 为 `https://www.packyapi.com/v1`；按其账户提供的模型名和令牌填写。令牌只保存在本机配置中，禁止提交 `.env`、令牌或数据库密码到 GitHub。

后端启动时会继续自动检测模型可用性；模型不可用时，不要开始批量任务。

## 4. 加载 Chrome 插件

1. 打开 `chrome://extensions/`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择 `dist/auto-comment-plugin`，不要选择项目根目录或旧目录。
5. 确认插件显示为 `BacklinkAssistant 1.1.0`。

代码更新后，在同一页面点击插件的“重新加载”，再刷新已打开的目标网页。

## 5. 发布检查与打包

发布前执行：

```powershell
npm test
```

仅打包 `dist/auto-comment-plugin`；不要将 `.env`、`node_modules`、`output`、`storage`、日志或本地数据库放入发布包。

```powershell
Compress-Archive -Path dist\auto-comment-plugin\* -DestinationPath BacklinkAssistant-1.1.0.zip -Force
```

## 6. 常见问题

- 后端未连接：运行 `npm run local:stack:start`，再访问 `/health`。
- AI 生成失败：先在“模型配置”测试连通性，核对模型名、接口路径和令牌。
- 界面仍是旧版本：在 `chrome://extensions/` 重新加载插件并刷新目标页。
- 数据库异常：确认 Docker Desktop 已启动，再运行 `npm run local:db:start` 与 `npm run local:db:setup`。
