# API 文档

## 概述

输入 `.osz` 谱面文件，返回难度分析结果（SR、难度Label、LN比率、Keys等）。

## Base URL

```
http://localhost:3000
```

## Endpoints

### `POST /analyze`

分析谱面难度。

**Content-Type:** `multipart/form-data`

#### 请求参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `file` | file | ✅ | — | `.osz` 谱面文件 |
| `mods[]` | string[] | ❌ | `[]` | Mod 列表，见下方 |
| `algorithm` | string | ❌ | `Mixed` | 计算算法，见下方 |
| `includeExtras` | string | ❌ | `false` | `true` 时返回 pattern 分析和 interlude SR |

#### Mods

| Mod | 说明 | 效果 |
|-----|------|------|
| `DT` | Double Time | speedRate × 1.5 |
| `NC` | Night Core | 同 DT |
| `HT` | Half Time | speedRate × 0.75 |
| `HR` | Hard Rock | OverallDifficulty + 约30% |
| `EZ` | Easy | OverallDifficulty − 约70% |
| `IN` | Convert (LN→RC) | 长条转为红键 |
| `HO` | Hold Off | 长条转为普通音符 |

#### Algorithms

| 算法 | 说明 |
|------|------|
| `Sunny` | Suuny Rework，直接映射 SR |
| `Daniel` | Daniel 算法，仅 4K |
| `Azusa` | 改进 Daniel，4K RC 优先 |
| `Mixed` | **默认**，根据 LN 比率和 Key 数自动选择最佳算法 |

#### 请求示例

```bash
# 原速分析
curl -X POST http://localhost:3000/analyze \
  -F "file=@map.osz"

# DT
curl -X POST http://localhost:3000/analyze \
  -F "file=@map.osz" \
  -F "mods[]=DT"

# 多 Mod 组合
curl -X POST http://localhost:3000/analyze \
  -F "file=@map.osz" \
  -F "mods[]=DT" \
  -F "mods[]=HR"

# 指定算法
curl -X POST http://localhost:3000/analyze \
  -F "file=@map.osz" \
  -F "algorithm=Sunny"

# 包含额外信息
curl -X POST http://localhost:3000/analyze \
  -F "file=@map.osz" \
  -F "mods[]=DT" \
  -F "includeExtras=true"
```

#### 响应示例

```json
{
  "success": true,
  "filename": "map.osz",
  "result": {
    "starRating": 7.451,
    "lnRatio": 0.374,
    "columnCount": 4,
    "difficultyLabel": "Gamma low || LN 13 mid/low",
    "algorithm": "Mixed",
    "speedRate": 1.5,
    "odFlag": null,
    "cvtFlag": null,
    "patternReport": { ... },
    "interludeStar": 9.29,
    "etternaValues": null
  }
}
```

#### 响应字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `starRating` | number | Star Rating (SR) |
| `lnRatio` | number | Long Note 比率 (0~1) |
| `columnCount` | number | Key 数 (4/6/7) |
| `difficultyLabel` | string | 难度等级文字描述，格式为 `RC等级 \|\| LN等级` |
| `algorithm` | string | 使用的算法 |
| `speedRate` | number | 时间倍率 (1.0/0.75/1.5) |
| `odFlag` | string\|null | OD 修改标志 (HR/EZ/null) |
| `cvtFlag` | string\|null | 转换标志 (IN/HO/null) |
| `patternReport` | object\|null | Pattern 分析报告（需 includeExtras） |
| `interludeStar` | number\|null | Interlude SR（需 includeExtras） |
| `etternaValues` | object\|null | Etterna MSD 7项技能值（需 includeExtras） |

##### difficultyLabel 格式

格式为 `RC难度 || LN难度`，`||` 左侧为普通谱面难度，右侧为含LN时的难度：

- `Gamma low || LN 13 mid/low` → Gamma low 难度，或 LN 13 mid/low（含大量长条时参考右侧）
- 当 LN 比率 < 15% 时，`|| LN` 部分省略

难度等级：Intro → Reform → Alpha/Beta/Gamma/Delta/Epsilon/Zeta/Eta/Theta（希腊字母等级）

##### patternReport 结构

```json
{
  "Clusters": [
    {
      "Pattern": "Wildcard",
      "SpecificTypes": [["Jacky WC", 0.67], ["Speedy WC", 0.33]],
      "RatingMultiplier": 0.45,
      "BPM": 150,
      "Mixed": true,
      "Amount": 104060,
      "Importance": 7024050
    }
  ],
  "Category": "Jacky WC Tech",
  "LNPercent": 0.374,
  "HBRowRatio": 0.056,
  "ModeTag": "Mix",
  "SVAmount": 0,
  "Duration": 235074
}
```

---

### `GET /health`

健康检查。

```bash
curl http://localhost:3000/health
```

```json
{ "status": "ok" }
```

---

## 错误码

| HTTP 状态码 | 说明 |
|-------------|------|
| `400` | 未上传文件，或 .osz 中未找到 .osu |
| `500` | 分析过程异常（文件格式错误等） |

错误响应格式：

```json
{ "error": "错误信息描述" }
```

---

## 局限性

- **Etterna MSD（`etternaValues`）** — WASM 加载器使用 `import.meta.url` 路径解析，在某些 Node.js 环境下路径计算较复杂，当前可能返回 `null`。错误被内部 catch 住，SR 和 difficultyLabel 等核心结果不受影响。
- **Companella** — Neural Network 估算器依赖 `classifyCompanellaDifficulty`，当 Mixed 算法选中时会在后台静默 fallback 到 Sunny。