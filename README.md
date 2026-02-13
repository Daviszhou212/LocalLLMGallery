# LocalLLMGallery

[![CI](https://github.com/Daviszhou212/LocalLLMGallery/actions/workflows/ci.yml/badge.svg)](https://github.com/Daviszhou212/LocalLLMGallery/actions/workflows/ci.yml)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Platform Windows](https://img.shields.io/badge/platform-windows-0078D6?logo=windows&logoColor=white)](#快速开始quick-start)

本项目是一个本地可运行的图像生成控制台，面向 OpenAI 兼容接口，支持模型拉取、图片生成与本地图廊管理。  
This project is a local image-generation console for OpenAI-compatible APIs, with model fetching, image generation, and local gallery management.

## 目录 / Table of Contents

- [项目概览 / Overview](#项目概览--overview)
- [核心特性 / Features](#核心特性--features)
- [技术栈 / Tech Stack](#技术栈--tech-stack)
- [目录结构 / Project Structure](#目录结构--project-structure)
- [快速开始 / Quick Start](#快速开始--quick-start)
- [环境变量 / Environment Variables](#环境变量--environment-variables)
- [使用说明 / Usage](#使用说明--usage)
- [本地 API / Local API](#本地-api--local-api)
- [安全说明 / Security Notes](#安全说明--security-notes)
- [开发与质量 / Development & Quality](#开发与质量--development--quality)
- [CI 流程 / CI Workflow](#ci-流程--ci-workflow)
- [常见问题 / FAQ](#常见问题--faq)
- [许可证 / License](#许可证--license)

## 项目概览 / Overview

该项目由两个部分构成：

- 前端：静态页面（`public/`），用于输入模型参数、发起请求、展示与管理结果。
- 后端：本地 Node.js 服务（`server/`），用于：
  - 转发上游模型列表请求
  - 保存/读取/删除画廊条目
  - 执行写接口鉴权与限流
  - 执行远程图片抓取与安全校验

上游兼容接口：

- `POST /v1/chat/completions`
- `POST /v1/images/generations`
- `GET /v1/models`

## 核心特性 / Features

- 双模式生成：聊天图像模式与图片生成模式
- 模型拉取：通过本地服务获取上游模型列表
- 结果解析：支持 URL 与 Base64 data URL
- 画廊管理：保存、列表、预览、下载、删除
- 写接口保护：`x-local-token` + 本地 token 校验
- 限流保护：固定窗口限流，防止写接口被刷
- 图片抓取防护：超时、体积上限、重定向限制、受限地址拦截

## 技术栈 / Tech Stack

- Node.js `>=18`
- Backend: `express`, `cors`, `morgan`
- Frontend: Vanilla HTML/CSS/JavaScript
- Test: Node test runner (`node --test`) + `supertest`
- Lint/Format: `eslint`, `prettier`
- CI: GitHub Actions（Windows runner + Node 20）

## 目录结构 / Project Structure

```text
.
├── .github/
│   └── workflows/
│       └── ci.yml
├── public/
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   └── js/
├── server/
│   ├── constants.js
│   ├── errors.js
│   ├── gallery-store.js
│   ├── image-fetcher.js
│   └── index.js
├── tests/
├── gallery/
├── .env.example
├── package.json
└── start.bat
```

## 快速开始 / Quick Start

### 1. 前置条件 / Prerequisites

- Node.js `>=18`
- npm

### 2. 安装依赖 / Install

```bash
npm install
```

### 3. 配置环境变量 / Configure

复制 `.env.example` 并按需设置。  
At minimum, set `LOCAL_API_TOKEN` for write operations.

### 4. 启动服务 / Run

Windows 推荐：

```bat
start.bat
```

通用方式：

```bash
npm run start
```

启动后访问：

- `http://127.0.0.1:8086`

## 环境变量 / Environment Variables

| 变量 / Variable | 默认值 / Default | 说明 / Description |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | 本地服务监听地址 / Bind host |
| `PORT` | `8086` | 本地服务端口 / Bind port |
| `LOCAL_API_TOKEN` | `""` | 写接口 token / Write-auth token |
| `ALLOW_INSECURE_LOCAL` | `false` | 本地调试时允许放宽鉴权 / Dev-only insecure override |
| `REQUEST_TIMEOUT_MS` | `15000` | 上游请求超时 / Upstream timeout |
| `IMAGE_FETCH_TIMEOUT_MS` | `15000` | 图片抓取超时 / Image fetch timeout |
| `IMAGE_FETCH_MAX_BYTES` | `15728640` | 最大图片体积 / Max image size |
| `JSON_BODY_LIMIT` | `20mb` | JSON 请求体限制 / JSON body limit |
| `WRITE_RATE_LIMIT_WINDOW_MS` | `60000` | 写接口限流窗口 / Rate-limit window |
| `WRITE_RATE_LIMIT_MAX` | `60` | 窗口内写请求上限 / Max writes in window |

## 使用说明 / Usage

1. 填写 `Base URL`、`API Key`、`画廊服务 URL`、`Local Token`。
2. 点击“连接 URL”拉取模型列表。
3. 选择模型并填写 `Prompt`，点击生成。
4. 在结果区可下载、复制链接、保存到画廊。
5. 在画廊页可浏览、预览、删除图片。

## 本地 API / Local API

### `GET /api/health`

健康检查，返回服务可用状态及运行信息。

返回示例：

```json
{
  "ok": true,
  "storeReady": true,
  "writeLockQueueDepth": 0,
  "uptimeSec": 123
}
```

### `POST /api/models/fetch`

通过本地服务拉取上游模型列表。

请求示例：

```json
{
  "baseUrl": "http://127.0.0.1:8000/v1",
  "apiKey": "your-api-key"
}
```

### `GET /api/gallery/list`

返回当前画廊条目。

### `POST /api/gallery/save`

保存图片到本地画廊。

- 鉴权头：`x-local-token: <LOCAL_API_TOKEN>`
- 请求体中 `imageUrl` 与 `dataUrl` 必须二选一

### `DELETE /api/gallery/:id`

删除画廊条目。

- 鉴权头：`x-local-token: <LOCAL_API_TOKEN>`

## 安全说明 / Security Notes

- 本地 API 不等于无风险。  
  Local deployment does not automatically mean safe.
- 建议始终设置 `LOCAL_API_TOKEN`。  
  Always set `LOCAL_API_TOKEN` for write endpoints.
- 不要提交真实密钥、token、`.env` 文件到仓库。  
  Never commit real secrets or `.env`.
- `ALLOW_INSECURE_LOCAL=true` 仅用于临时开发调试。  
  Use `ALLOW_INSECURE_LOCAL=true` only for temporary local debugging.

## 开发与质量 / Development & Quality

本地质量命令：

```bash
npm run check
npm run lint
npm run test
npm run format:check
```

建议在每次提交前执行上述命令。  
Run these checks before each commit.

## CI 流程 / CI Workflow

CI 文件：`.github/workflows/ci.yml`  
触发条件：`push`、`pull_request`  
执行内容：

- Syntax check
- Lint
- Test
- Format check

## 常见问题 / FAQ

### 1. 模型拉取失败 / Model fetch failed

- 检查 `Base URL` 是否正确且可访问
- 检查上游是否支持 `GET /v1/models`
- 检查 API Key 权限或格式

### 2. 保存画廊失败（401/403/503）/ Gallery save failed

- 检查 `x-local-token` 是否携带
- 检查 `LOCAL_API_TOKEN` 是否配置且一致
- 检查是否误用 `ALLOW_INSECURE_LOCAL`

### 3. 页面打开但功能异常 / Frontend works incorrectly

- 使用 `http://127.0.0.1:8086` 打开
- 不要直接 `file://` 打开页面

### 4. 图片抓取失败 / Image fetch failed

- 检查 URL 可访问性
- 检查体积和超时限制
- 受限内网地址会被拦截

## 许可证 / License

`License TBD`
