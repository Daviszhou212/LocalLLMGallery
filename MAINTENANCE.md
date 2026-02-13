# 维护文档（`imag-generator`）

## 1. 项目概览

`llm-image-console` 是一个本地可运行的 LLM 画图控制台，包含前端页面与后端服务。

- 前端用途：填写 `Base URL`、`API Key`、模型与参数，调用上游接口生成图片。
- 后端用途：提供模型拉取、画廊读写、静态资源服务。
- 上游接口（README 已声明）：
  - `POST /v1/chat/completions`
  - `POST /v1/images/generations`
  - `POST /v1/images/edits`（image-edit）
  - `GET /v1/models`
- 默认访问地址：
  - 前端/服务：`http://127.0.0.1:8086`
  - 默认上游 Base URL：`http://127.0.0.1:8000/v1`

## 2. 技术栈与运行依赖

- 运行时：
  - `Node.js >= 18`（`package.json` `engines.node`）
  - `npm`
- 后端依赖：
  - `express`
  - `cors`
  - `morgan`
- 开发与质量工具：
  - `eslint`
  - `prettier`
  - `supertest`
  - `node:test`
- 常用脚本（`package.json`）：
  - `npm run start` / `npm run dev`：启动服务（`node server/index.js`）
  - `npm run check`：`node --check` 语法检查
  - `npm run lint`：ESLint 检查
  - `npm run test`：`node --test --test-concurrency=1`
  - `npm run format:check`：Prettier 检查

## 3. 目录与关键入口

- `start.bat`：Windows 启动脚本（自动检查 `npm`、必要时安装依赖、启动服务）。
- `server/index.js`：后端主入口与路由注册。
- `server/constants.js`：运行目录、端口、超时、限流等配置读取入口。
- `server/gallery-store.js`：画廊文件落盘与 `index.json` 维护（含写锁队列与损坏备份）。
- `server/image-fetcher.js`：`dataUrl` 解析与远程图片拉取（含大小、协议、地址限制）。
- `server/errors.js`：统一错误结构与 HTTP 错误映射。
- `public/index.html` + `public/app.js` + `public/js/*.js`：前端页面与交互逻辑。
- `tests/`：
  - `tests/server-api.test.js`
  - `tests/image-fetcher.test.js`
  - `tests/gallery-store.test.js`
- `gallery/`：运行时生成的图片目录与索引文件 `index.json`。

## 4. 本地启动与停止

### 启动方式 A（推荐，Windows）

在项目根目录运行：

```bat
start.bat
```

脚本行为（`start.bat` 可验证）：

1. 检查 `npm` 是否存在。
2. `node_modules` 不存在时执行 `npm install`。
3. 如果 `LOCAL_API_TOKEN` 未设置，自动 `set ALLOW_INSECURE_LOCAL=true`（本机调试）。
4. 执行 `npm run start`，服务监听 `http://127.0.0.1:8086`。

### 启动方式 B（手动）

```bash
npm install
npm run start
```

### 停止服务

- 在启动服务的终端按 `Ctrl+C`。

### 启动后最小验证

- 浏览器访问：`http://127.0.0.1:8086`
- 健康检查接口：`GET /api/health`（预期返回 `ok`、`storeReady`、`writeLockQueueDepth`、`uptimeSec`）

## 5. 配置与环境变量

以下变量来自 `server/constants.js` 与 `start.bat`，均可直接在仓库核验。

- `PUBLIC_DIR`：静态资源目录；默认 `<ROOT_DIR>/public`
- `GALLERY_DIR`：画廊目录；默认 `<ROOT_DIR>/gallery`
- `GALLERY_INDEX_FILE`：索引文件；默认 `<GALLERY_DIR>/index.json`
- `HOST`：默认 `127.0.0.1`
- `PORT`：默认 `8086`
- `LOCAL_API_TOKEN`：本地写接口鉴权 token（请求头 `x-local-token`）
- `ALLOW_INSECURE_LOCAL`：`true/1` 时，`LOCAL_API_TOKEN` 缺失也允许写接口（仅本机调试）
- `REQUEST_TIMEOUT_MS`：模型拉取超时；默认 `15000`
- `IMAGE_FETCH_TIMEOUT_MS`：图片拉取超时；默认 `15000`
- `IMAGE_FETCH_MAX_BYTES`：图片拉取大小限制；默认 `15728640`（15MB）
- `JSON_BODY_LIMIT`：JSON body 大小限制；默认 `20mb`
- `WRITE_RATE_LIMIT_WINDOW_MS`：写接口限流窗口；默认 `60000`
- `WRITE_RATE_LIMIT_MAX`：写接口窗口最大请求数；默认 `60`

写接口范围（均在 `server/index.js`）：

- `POST /api/models/fetch`
- `POST /api/gallery/save`
- `DELETE /api/gallery/:id`

以上写接口都经过 `requireLocalToken` 与限流中间件。

## 6. 核心维护流程

### 6.1 日常运行检查

1. 启动服务（`start.bat` 或 `npm run start`）。
2. 访问 `GET /api/health`，确认服务可用与存储状态正常。
3. 检查启动日志中的路径输出：
   - `Server started at http://<HOST>:<PORT>`
   - `Static dir: ...`
   - `Gallery dir: ...`

### 6.2 功能冒烟（前后端联通）

1. 打开 `http://127.0.0.1:8086`。
2. 点击“连接 URL”（触发 `POST /api/models/fetch`）。
3. 发起一次生成（上游 `chat/completions` / `images/generations` / `images/edits`）。
4. `image-edit` 模式下，确认模型名包含 `edit` 且已提供原图（URL 或上传）。
5. 在结果区执行“保存到画廊”（触发 `POST /api/gallery/save`）。
6. 在画廊页验证列表加载与删除（`GET /api/gallery/list`、`DELETE /api/gallery/:id`）。

### 6.3 存储与索引维护

1. 关注 `gallery/index.json` 是否可正常解析。
2. 若索引损坏，`gallery-store` 会尝试生成 `index.json.bak-<timestamp>` 备份。
3. 定期核对 `gallery/` 实际文件与索引一致性（删除接口会同步删索引并尝试删文件）。

### 6.4 质量检查流程

按顺序执行：

```bash
npm run check
npm run lint
npm run test
npm run format:check
```

## 7. 故障排查

### 条目 1：写接口返回 `401 LOCAL_TOKEN_MISSING` 或 `403 LOCAL_TOKEN_INVALID`

- 症状：保存画廊/删除画廊/模型拉取失败，并提示鉴权错误。
- 定位：
  - 检查请求头是否带 `x-local-token`。
  - 检查服务端 `LOCAL_API_TOKEN` 是否已设置且与前端一致。
- 处理：
  - 统一前后端 token；
  - 仅本机调试场景可临时启用 `ALLOW_INSECURE_LOCAL=true`。

### 条目 2：写接口返回 `503 LOCAL_TOKEN_NOT_CONFIGURED`

- 症状：写接口被拒绝，提示服务端未配置 token。
- 定位：
  - `LOCAL_API_TOKEN` 为空；
  - 且 `ALLOW_INSECURE_LOCAL` 未开启。
- 处理：
  - 推荐设置 `LOCAL_API_TOKEN`；
  - 或在本地调试时开启 `ALLOW_INSECURE_LOCAL=true`。

### 条目 3：返回 `413 PAYLOAD_TOO_LARGE` 或 `IMAGE_TOO_LARGE`

- 症状：保存 `dataUrl` 或远程拉图失败，提示请求体/图片过大。
- 定位：
  - 查看 `JSON_BODY_LIMIT` 与 `IMAGE_FETCH_MAX_BYTES` 当前配置；
  - 确认上游图片体积。
- 处理：
  - 降低图片大小后重试；
  - 或按需调整 `JSON_BODY_LIMIT`、`IMAGE_FETCH_MAX_BYTES`。

### 条目 4：画廊读取异常，提示索引损坏

- 症状：读取画廊失败，报索引文件损坏。
- 定位：
  - 检查 `gallery/index.json` 是否为合法 JSON；
  - 查找是否生成 `index.json.bak-<timestamp>`。
- 处理：
  - 从最近备份恢复；
  - 无可用备份时，修复为合法 JSON 数组格式后重启服务。

### 条目 5：模型拉取失败或超时（`502/504`）

- 症状：“连接 URL”失败，提示上游不可用或超时。
- 定位：
  - 核对 `Base URL`；
  - 检查上游是否支持 `GET /v1/models`；
  - 检查 `REQUEST_TIMEOUT_MS` 设置。
- 处理：
  - 修正 URL/Key；
  - 恢复上游服务；
  - 按需增大超时后重试。

### 条目 6：`image-edit` 按钮不可点击

- 症状：切到 `image-edit` 后提交按钮置灰。
- 定位：
  - 检查模型列表中是否存在名称包含 `edit` 的模型；
  - 检查是否已填写原图 URL，或已上传本地图片；
  - 检查当前选中的模型名是否包含 `edit`。
- 处理：
  - 重新连接支持 edit 的上游；
  - 切换到可用的 edit 模型；
  - 补充原图后重试。

### 条目 7：`image-edit` 返回 `HTTP 400 - Field required`

- 症状：调用 `/v1/images/edits` 时报缺少字段。
- 定位：
  - 若上游是 `grok2api`，其 `images/edits` 需要 `multipart/form-data`；
  - 必须传 `image` 文件字段，而不是 JSON 的 `image_url`。
- 处理：
  - 确认前端请求为 `multipart/form-data`；
  - 确认上传/URL 已成功转换为图片文件并附在 `image` 字段。

## 8. 变更与发布流程

仓库内未提供自动发布脚本；按以下手工流程执行。

1. 完成代码变更后先执行质量检查（`check`/`lint`/`test`/`format:check`）。
2. 本地启动服务并做一次端到端冒烟（模型拉取、生成、保存、删除）。
3. 检查关键运行日志与 `api/health`。
4. 确认 `README.md` 与本维护文档是否需要同步更新。

### 发布前核对项

- [ ] `npm run check` 通过
- [ ] `npm run lint` 通过
- [ ] `npm run test` 通过
- [ ] `npm run format:check` 通过
- [ ] `http://127.0.0.1:8086` 可访问
- [ ] `GET /api/health` 返回正常
- [ ] 写接口鉴权策略确认（`LOCAL_API_TOKEN` 或受控的 `ALLOW_INSECURE_LOCAL`）
- [ ] 画廊保存/列表/删除流程可用

## 9. 维护检查清单（日/周/月）

### 每日

- [ ] 检查服务可启动，`/api/health` 正常。
- [ ] 抽样执行一次“连接 URL -> 生成 -> 保存到画廊”。
- [ ] 检查最近错误日志是否出现 `401/403/413/502/504` 高频异常。

### 每周

- [ ] 执行完整质量检查：`check`、`lint`、`test`、`format:check`。
- [ ] 检查 `gallery/index.json` 与 `gallery/` 文件一致性。
- [ ] 检查是否出现 `index.json.bak-*`，若有则确认原因并清理风险。

### 每月

- [ ] 复核环境变量与默认值是否符合当前部署要求。
- [ ] 复核写接口限流参数：`WRITE_RATE_LIMIT_WINDOW_MS`、`WRITE_RATE_LIMIT_MAX`。
- [ ] 复核图片拉取策略参数：`REQUEST_TIMEOUT_MS`、`IMAGE_FETCH_TIMEOUT_MS`、`IMAGE_FETCH_MAX_BYTES`。
- [ ] 复核启动脚本 `start.bat` 的本地安全策略使用情况（避免长期依赖 `ALLOW_INSECURE_LOCAL=true`）。

## 10. 附录

### 10.1 关键接口清单（后端）

- `GET /api/health`
- `POST /api/models/fetch`（写接口，需鉴权）
- `GET /api/gallery/list`
- `POST /api/gallery/save`（写接口，需鉴权）
- `DELETE /api/gallery/:id`（写接口，需鉴权）
- `GET /`（返回 `public/index.html`）
- `GET /gallery/*`（画廊静态文件）

### 10.2 关键测试覆盖点（`tests/`）

- `server-api.test.js`：健康检查字段、写接口 token 校验、无效保存参数校验。
- `image-fetcher.test.js`：非法 `dataUrl`、超限图片、非图片内容、超时处理。
- `gallery-store.test.js`：并发保存一致性、索引损坏备份行为。

### 10.3 快速命令参考

```bash
npm run start
npm run check
npm run lint
npm run test
npm run format:check
```
