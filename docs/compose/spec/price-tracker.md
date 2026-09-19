---
feature: price-tracker
status: delivered
updated: 2026-09-19
branch: main
commits: 5678781..HEAD
---

# 每日代发价采集与趋势网页

## Report

**What was built** — 一套「斗货商城已选品代发价」监控：Node 零依赖采集脚本拉全量选品与 SKU `plat_price`，写入 `products.json` / `history.json`（含 `docs/data/` 副本）；静态网页列表展示最低价与涨跌（红涨绿跌），点击商品打开侧栏 Chart.js 历史折线；采集产物另有一个零依赖自检脚本 `scripts/selftest.js` 把关数据契约。网页右上角「刷新」按钮可**按需触发一次采价**：浏览器带 GitHub 令牌调 GitHub API 触发 Actions 工作流，轮询到完成后自动重载数据。

**Verification** — `node scripts/collect.js` 成功采集 14 个商品（真实 API）；`node scripts/selftest.js` 全项通过；`npm run serve` + Playwright：列表渲染、搜索、有涨价筛选、侧栏图表 canvas 正常；`node --check` 通过。刷新链路端到端实测：`POST …/dispatches` 返回 **204**，对应运行 `35436145842` 在 ~30s 内 `completed / success`。

**Journey log**
- Token 签名 `md5(app_id+mobile+timestamp+app_secret)` 实测可用；`plat_price` 即代发价。
- Gitee Go 不能按 GitHub Actions YAML 用：官方为纯 UI 流水线。仓库已迁到 **GitHub Pages + GitHub Actions**，Gitee 相关配置全部移除。
- 展示目录从 `site/` 迁到 `docs/`（Pages 可直接指向分支子目录），`data/` 与 `docs/data/` 双写。
- 首日仅 1 个历史点时趋势显示占位，属预期。
- 涨跌按「当前最低价 SKU 与自身上次价」配对，避免多 SKU 交叉比较。
- 商品名进 HTML 前统一 escape；缩略图 URL 仅允许 http(s)。
- **GitHub 定时任务实测不触发**：历史运行全部是 `workflow_dispatch`，`schedule` 一次都没跑。先用 `*/30` 探针、后用 `*/10` 连续观察 **8 小时 / 48 次机会 / 0 次触发**排除「注册未生效」；仓库设置（public、未归档、Actions 已开启、默认分支 `main`）全部正常，判定为 GitHub 侧不可靠。**结论：不把定时当主力。**
- 定时最终收敛为 `17 1 * * *`（= 09:17 北京时间），仅作兜底，文件注释中写明该前提。
- 采集频率从 `*/30`（每 30 分钟）改为每天一次，避开整点（GitHub 整点负载最高、定时可能被延迟或丢弃）。
- 本地 Windows 的 CRLF 与 Linux CI 的 LF 一直互相覆盖，产生整文件的假 diff（`docs/app.js` 曾显示 1172 行变更）。已加 `.gitattributes` 统一为 LF，`.bat` 保持 CRLF。
- `data/products.json` 曾带 UTF-8 BOM，虽然浏览器 `Response.json()` 能容忍，但 Node 侧 `JSON.parse` 会抛错并退化成空数据。现在自检脚本会剥掉 BOM 后再解析。
- **「刷新 → 采价」的可行性是实测出来的**：斗货接口**不返回任何跨域放行头**（CORS 预检失败），且密钥不能放进公开网页，因此浏览器**无法**直接采价；而 `api.github.com` 返回 `Access-Control-Allow-Origin: *` 并放行 `POST` + `Authorization`，所以浏览器可以触发 Actions。方案据此定型为「网页触发 GitHub」。

## [S1] Problem

运营需要每天盯住斗货商城后台「已选品」商品的代发价（`plat_price`）。目前只能进后台逐个看，无法：

1. 一页看到全部已选品的当前代发价；
2. 点开某个商品，看到历史价格趋势（是否涨价/降价）；
3. 在无人值守的情况下自动采集并更新；
4. 在需要时**立刻**拉一次最新价，而不必等到第二天。

## [S2] Design

### 架构

```
【主力】网页「刷新」按需触发
  浏览器（带 GitHub 令牌）
    └─ POST api.github.com/…/price-sync.yml/dispatches
         └─ GitHub Actions 启动
              └─ scripts/collect.js（用 Secrets 里的斗货密钥）
              └─ scripts/selftest.js
              └─ git commit & push（有变更才推）
    └─ 轮询运行状态 → 成功后自动重载 data/*.json

【兜底】GitHub Actions 定时（每天 09:17 北京时间）
  同一工作流的 schedule 触发；实测不可靠，仅作保险

【兜底】本机计划任务 collect-and-push.bat / crontab

GitHub Pages（静态托管 docs/）
  └─ 读取 docs/data/products.json 与 history.json
       ├─ 商品列表（最新价、涨跌）
       └─ 点击商品 → Chart.js 趋势图
```

### 成本

仓库为 **public**，因此 GitHub Actions 分钟数不计费、GitHub Pages 托管免费、Chart.js 走公共 CDN。项目整体零支出——**点多少次「刷新」都是零**。若仓库转为 private，Actions 将开始消耗 Free 计划额度。

### 认证（两层，互相隔离）

| 凭证 | 存放 | 用途 | 是否可能公开 |
|------|------|------|--------------|
| `DOUHUO_APP_ID` / `DOUHUO_APP_SECRET` / `DOUHUO_MOBILE` | 本地 `.env`；CI 用 GitHub **Secrets（加密）** | 采集脚本取 token | 否。GitHub 存入后不可再读出（API 只返回名字），日志中自动打码 |
| **GitHub 令牌**（用户粘贴） | 浏览器 `localStorage` | 仅用于触发 Actions 工作流 | 否。不上传、不提交 |

- sign = `md5(app_id + mobile + timestamp + app_secret)`，32 位小写十六进制。
- token 失效（`error_code != 0` 或接口报 token 过期）时自动重新获取并重试一次。
- 频控：接口限制 5 秒 80 次；采集脚本对详情请求做 80ms 间隔串行，远低于上限。
- **最小权限**：`dispatches` 需要该仓库的 `Actions: Read and write`（经典 token 需 `workflow`）。按此配置，令牌即便泄露最坏也只能重复触发采价，读不到仓库密钥、动不了其他仓库。401 → 清除并重填；403 → 提示权限不足；404 → 提示未授权该仓库。
- **绝不**把任何令牌或 App Secret 写进 `docs/`、README 或 commit 信息（仓库公开）。

### 数据契约

`data/products.json` — 最新快照（前端主数据）：

```json
{
  "updated_at": "2026-09-19T01:17:00.000Z",
  "date": "2026-09-19",
  "goods_count": 14,
  "error_count": 0,
  "errors": [],
  "goods": [
    {
      "goods_id": 1102746933,
      "goods_name": "…",
      "spu_sn": "GDE2594D6C1",
      "main_img": "https://…",
      "status": 1,
      "supply_type": 17,
      "sku_count": 1,
      "min_price": 18.36,
      "max_price": 18.36,
      "prev_price": 18.0,
      "price_change": 0.36,
      "price_change_pct": 2.0,
      "skus": [
        {
          "sku_id": 1250569154,
          "sku_name": "…",
          "attr_text": "福临门… / 国内发货 / 1件",
          "price": 18.36,
          "retail_price": 30,
          "status": 1,
          "prev_price": 18.0
        }
      ]
    }
  ]
}
```

`data/history.json` — 按日追加的历史（趋势图数据源）：

```json
{
  "1102746933": {
    "name": "…",
    "skus": {
      "1250569154": {
        "attr": "…",
        "points": [
          { "date": "2026-09-18", "price": 18.0 },
          { "date": "2026-09-19", "price": 18.36 }
        ]
      }
    }
  }
}
```

- 同一天重复采集时覆盖当日点，不追加重复日期。
- 历史默认保留 180 天，超出按日期裁剪。
- `docs/data/products.json` 与 `docs/data/history.json` 必须与 `data/` 下同名文件**字节一致**，由自检脚本强制。

### 自检（scripts/selftest.js）

零依赖，`npm run selftest` 或 CI 内执行，退出码非 0 即视为失败：

| # | 检查项 |
|---|--------|
| 1 | `data/` 与 `docs/data/` 两份副本字节一致 |
| 2 | `products.json` 顶层结构、`goods_count` / `error_count` 与数组长度自洽 |
| 3 | 每个商品与规格字段完整，价格要么是数字要么是 null |
| 4 | `history.json` 结构合法且非空 |
| 5 | 快照中有价格的规格，在 history 中有当日点且价格一致 |
| 6 | history 时间点日期格式正确、严格递增、价格是数字 |
| 7 | 快照日期是否为北京时间今天（只提醒，不算失败） |

### 前端行为

- 打开页面自动拉 `products.json` + `history.json`；失败时提示并提供「重试」。
- 概览：在售商品 / 今日涨价 / 今日降价 / 最大涨跌。
- 列表字段：缩略图、商品名、渠道标签、SPU 编码、当前最低代发价、较上次涨跌（↑ 红 / ↓ 绿 / — 灰）、SKU 数、更新时间。
- 筛选：搜索框；渠道下拉（按 supply_type）；「全部 / 有涨价 / 有降价」chip。
- 涨价提醒：顶部横幅汇总涨价商品；顶栏「涨价 N」按钮一键筛出；涨价行左侧红点与浅红底。
- 导出 CSV：当前筛选结果，UTF-8 BOM，字段含采集日期/goods_id/SPU/名称/渠道/价格/涨跌。
- 点击行打开详情面板：
  - 每个 SKU 一张 Chart.js 折线图（日期 x，代发价 y）；
  - 显示当前价、首次价、最高、最低、涨跌额。
- 无历史或仅 1 个点时显示占位说明，不画空图报错。
- **「刷新」按钮 = 按需采价**：
  1. 无令牌 → 弹窗让用户粘贴 GitHub 令牌（密码框，存 `localStorage`，提供「清除」）；
  2. 有令牌 → `POST/GET api.github.com` 触发 `workflow_dispatch`（`ref: main`）；
  3. 触发后每 5s 轮询运行状态（最多 40 次），完成后重载数据；失败/超时给出对应提示；
  4. 冷却：`COOLDOWN_MS = 10min`，受 `COOLDOWN_ENABLED` 开关控制（当前测试阶段为 `false`，即不限制）；冷却期内点击只重载数据并提示剩余时间。
  - 按钮忙时禁用并显示「采价中…」；错误按 401/403/404 分别给出可执行提示。
- 纯静态，无构建步骤；Chart.js 使用 CDN（jsDelivr）。

### 部署

- **采集（主力）**：网页「刷新」按钮 → GitHub Actions `workflow_dispatch`。
- **采集（兜底）**：GitHub Actions 定时 09:17；本机计划任务 / crontab。
- **展示**：GitHub Pages 指向 `main` 分支的 `/docs` 目录。
- **教程**：根目录 `README.md`（中文）。

### 定时任务的可预期行为

GitHub 的 `schedule` 是尽力而为的，本项目已实测确认它**可能长期完全不触发**，设计上不依赖它：

- 定时只在**默认分支**、且 workflow 文件名**稳定**的前提下生效；重命名文件会重置注册。
- 避开整点（选 `01:17 UTC`），整点负载最高、最容易被丢弃。
- 仓库 60 天无活动会被自动停用定时；每日 bot commit 天然规避了这条。
- **实测**：`*/10` 连续 8 小时 0 触发，仓库设置正常 → 判定 GitHub 侧不可靠。
- 因此主力入口是**网页刷新按钮**（`workflow_dispatch`），另保留本机 `collect-and-push.bat` 作备份执行器。

### 错误行为

| 场景 | 行为 |
|------|------|
| token 失效 | 重新获取 token 并重试该请求 1 次，再失败则整次任务失败退出码 1 |
| 某商品详情失败 | 记入 `errors` 字段继续其它商品，任务仍成功但日志警告 |
| 全部商品失败 | 任务失败，退出码 1，不写入坏数据 |
| 网络失败 | 3 次指数退避重试 |
| 自检不通过 | CI 中止，不 commit、不 push |
| 前端拉不到 JSON | 顶部横幅提示 + 重试按钮 |
| 刷新时令牌 401/403/404 | 分别提示「令牌无效/权限不足/未授权该仓库」；401 自动清除已存令牌 |
| 刷新后运行失败/超时 | 提示到 GitHub Actions 查看日志 / 稍后再试 |

## [S3] Out of Scope

- 下单、运费、售后、物流等接口。
- 多账号/多 App。
- 用户登录鉴权（Pages 公开或私有由仓库决定，页面本身无登录；刷新用 GitHub 令牌做门槛）。
- 服务端自建中转（会引入运维成本与费用，故不采用；刷新走 GitHub API 直连）。
- 实时推送/webhook 增量（先用按需 + 每日全量）。
- 移动端深度适配（保证可读即可）。

## Tasks

- [x] T1: 采集脚本 `scripts/collect.js` — acceptance: 本地配置凭证后可跑通，生成 `data/products.json` 与 `data/history.json`，含真实代发价 (covers: S2)
- [x] T2: 静态页 `docs/` — acceptance: 打开列表可见已选品与涨跌，点击出现 SKU 趋势折线 (covers: S2)
- [x] T3: 定时采集与推送方案 — acceptance: GitHub Actions 每日采价并推送；本机 `collect-and-push.bat` / crontab 作备份 (covers: S2)
- [x] T4: 运行教程 `README.md` — acceptance: 按文档可完成 Pages 配置与定时采集配置 (covers: S2)
- [x] T5: 本地端到端验证 — acceptance: 采集脚本成功写文件，静态页可渲染列表与图表 (covers: S2; depends: T1, T2)
- [x] T6: 产物自检 `scripts/selftest.js` — acceptance: 校验两份副本一致、字段完整、history 与快照对齐；CI 中在推送前执行 (covers: S2; depends: T1)
- [x] T7: 定时可靠性收敛 — acceptance: 删除测试探针 workflow；`price-sync.yml` 收敛为单一稳定文件、cron 避开整点；README/spec 说明 `schedule` 的已知限制与排查方法 (covers: S2)
- [x] T8: 网页「刷新 → 触发采价」 — acceptance: 弹窗粘贴 GitHub 令牌并记住；点击后成功 dispatch（204）并在运行成功后自动重载；401/403/404 有可执行提示；冷却可配置（测试期关闭）；端到端实测通过 (covers: S2; depends: T2)
- [x] T9: 定时兜底时间定稿为 09:17 — acceptance: cron 为 `17 1 * * *`，并安排自动复查确认是否触发 (covers: S2)
