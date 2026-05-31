# 插件打包剔除清单

为打包浏览器插件，仅保留扩展运行时实际加载的文件：

- `manifest.json`
- `background.js`
- `content.js`
- `options.html`
- `options.js`
- `batch.html`
- `batch.js`
- `lib/papaparse.min.js`

## 可剔除目录

以下目录不属于浏览器插件运行时，可在打包前剔除：

- `.cursor/`：编辑器/AI 辅助规则。
- `.github/`：GitHub Actions 等仓库自动化配置。
- `.idea/`：JetBrains IDE 项目配置。
- `api/`：后端 API 服务源码，插件只请求线上 API，不需要随扩展分发。
- `deploy/`：服务器部署配置。
- `dist/`：历史构建产物和旧压缩包。
- `docs/`：开发文档和用户文档。
- `node_modules/`：后端 Node.js 依赖，浏览器插件不直接使用。

## 可剔除文件

以下文件不属于插件运行时，可在打包前剔除：

- `.commit_msg.txt`
- `.env`
- `.env.example`
- `.gitignore`
- `commit.bat`
- `commit2.bat`
- `commit_msg.txt`
- `combined-0.log`
- `DEPLOY.md`
- `ecosystem.config.js`
- `index.html`
- `package.json`
- `package-lock.json`
- `PROJECT_SUMMARY.md`
- `README.md`
- `server.js`
- `vercel.json`

## 注意

- `lib/` 不能整体删除，因为 `batch.html` 会加载 `lib/papaparse.min.js`。
- `.git/` 不是插件运行时文件；如果只是交付 zip，可以不包含它。如果还要保留版本历史，则留在工作目录即可。
- 修改 `manifest.json` 后，打包前建议用 JSON 解析校验一次，避免 Chrome 扩展加载失败。
