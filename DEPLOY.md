# 部署文档

## 环境要求

- Node.js >= 18
- pnpm >= 8

## 目录结构

```
osumania_map_analyser/
├── ManiaMapAnalyser by Leo_Black/   # 原项目（算法核心）
├── api/                              # API 服务
│   ├── package.json
│   ├── README.md
│   └── src/
│       ├── analyzer.js               # 分析逻辑封装
│       └── server.js                # Express 服务
└── docs/                            # 原项目文档站
```

## 快速部署

```bash
cd api
pnpm install
pnpm dev        # 开发模式（--watch）
# 或
pnpm start      # 生产模式
```

## 算法说明

API 直接复用原项目 `ManiaMapAnalyser by Leo_Black/` 下的算法模块，无需修改原项目：

| 模块 | 用途 |
|------|------|
| `js/rework/sunnyAlgorithm.js` | Sunny SR 计算核心 |
| `js/parser/osuFileParser.js` | .osu 文件解析 |
| `js/estimator/sunnyEstimator.js` | Sunny 估算器 |
| `js/estimator/danielEstimator.js` | Daniel 估算器 |
| `js/estimator/azusaEstimator.js` | Azusa 估算器 |
| `js/estimator/mixedEstimator.js` | Mixed 自动算法选择 |
| `js/estimator/reworkEstimatorUtils.js` | SR → 难度Label映射 |
| `js/patterns/service.js` | Pattern 分析 |
| `js/interlude/index.js` | Interlude Star Rating |
| `js/ett/index.js` | Etterna MSD (需要 WASM) |

原项目为浏览器插件，API 通过原生 ESM import 复用其逻辑，无需任何移植或改造。

## 已知限制

Etterna MSD 功能的 WASM 加载器依赖 `import.meta.url` + `locateFile`，在 Node.js 中路径解析指向 `api/src/versions/*.wasm`（错误路径），而非原项目 `ManiaMapAnalyser by Leo_Black/js/ett/versions/`。该功能返回 `null`，不影响 SR 和 difficultyLabel 等核心结果。如需启用，可将 WASM 相关文件复制到 API 的 `src/ett/versions/` 并重写 locateFile 路径。

## 配置

环境变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | HTTP 服务端口 |

## 生产部署

```bash
# 构建
cd api
pnpm install --prod

# 运行
NODE_ENV=production pnpm start
```

建议使用 PM2 / systemd 管理进程。