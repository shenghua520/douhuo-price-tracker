---
feature: price-tracker
status: delivered
updated: 2026-09-19
branch: main
commits: 5678781..HEAD
---

# 每日代发价采集与趋势网页

## Report

**What was built** — 一套「斗货商城已选品代发价」监控：Node 零依赖采集脚本每日拉全量选品与 SKU `plat_price`，写入 `products.json` / `history.json`（含 `docs/data/` 副本）；静态网页列表展示最低价与涨跌（红涨绿跌），点击商品打开侧栏 Chart.js 历史折线；采集产物另有一个零依赖自检脚本 `scripts/selftest.js` 把关数据契约。

**Verification** — `node scripts/collect.js` 成功采集 14 个商品（真实 API）；`node scripts/selftest.js` 全项通过；`npm run serve` + Playwright：列表渲染、搜索、有涨价筛选、侧栏图表 canvas 正常；`node --check` 通过。

**Journey log**
- Token 签名 `md5(app_id+mobile+timestamp+app_secret)` 实测可用；`plat_price` 即代发价。
- Gitee Go 不能按 GitHub Actions YAML 用：官方为纯 UI 流水线。仓库已迁到 **GitHub Pages + GitHub Actions**，Gitee 相关配置全部移除。
- 展示目录从 `site/` 迁到 `docs/`（Pages 可直接指向分支子目录），`data/` 与 `docs/data/` 双写。
- 首日仅 1 个历史点时趋势显示占位，属预期。
- 涨跌按「当前最低价 SKU 与自身上次价」配对，避免多 SKU 交叉比较。
- 商品名进 HTML 前统一 escape；缩略图 URL 仅允许 http(s)。
- **GitHub 定时任务实测不触发**：历史 32 次运行全部是 `workflow_dispatch`，`schedule` 一次都没跑。原因是 workflow 文件被反复重命名/新建，每次都会重置 GitHub 的定时注册。已收敛为单一稳定文件 `price-sync.yml`。
- 采集频率从 `*/30`（每 30 分钟）改为**每天一次**（`10 1 * * *` UTC = 09:10 北京时间）。避开整点，因为 GitHub 整点负载最高、定时任务可能被延迟或丢弃。
- 本地 Windows 的 CRLF 与 Linux CI 的 LF 一直互相覆盖，产生整文件的假 diff（`docs/app.js` 曾显示 1172 行变更）。已加 `.gitattributes` 统一为 LF，`.bat` 保持 CRLF。
- `data/products.json` 曾带 UTF-8 BOM，虽然浏览器 `Response.json()` 能容忍，但 Node 侧 `JSON.parse` 会抛错并退化成空数据。现在自检脚本会剥掉 BOM 后再解析。

## [S1] Problem

运营需要每天盯住斗货商城后台「已选品」商品的代发价（`plat_price`）。目前只能进后台逐个看，无法：

1. 一页看到全部已选品的当前代发价；
2. 点开某个商品，看到历史价格趋势（是否涨价/降价）；
3. 在无人值守的情况下每日自动采集并更新。

## [S2] Design

### 架构

```
GitHub Actions 定时（每天 09:10 北京时间）+ 手动 workflow_dispatch
  └─ scripts/collect.js
       ├─ getAccessToken
       ├─ getGoodsList (分页拉全量已选品)
       └─ getGoodsDetail (每个商品 SKU 的 plat_price)
            └─ 写入 data/products.json + data/history.json + docs/data/
  └─ scripts/selftest.js（数据契约自检，不通过则中止）
  └─ git commit & push（有变更才推）

GitHub Pages（静态托管 docs/）
  └─ 读取 docs/data/products.json 与 history.json
       ├─ 商品列表（最新价、涨跌）
       └─ 点击商品 → Chart.js 趋势图

备用执行器：本机计划任务 collect-and-push.bat / crontab
```

### 成本

仓库为 **public**，因此 GitHub Actions 分钟数不计费、GitHub Pages 托管免费、Chart.js 走公共 CDN。项目整体零支出。若仓库转为 private，Actions 将开始消耗 Free 计划额度。

### 认证

- App ID / App Secret / 主账号手机号来自环境变量（本地 `.env`，CI 用 GitHub Actions Secrets）。
- sign = `md5(app_id + mobile + timestamp + app_secret)`，32 位小写十六进制。
- token 失效（`error_code != 0` 或接口报 token 过期）时自动重新获取并重试一次。
- 频控：接口限制 5 秒 80 次；采集脚本对详情请求做 80ms 间隔串行，远低于上限。

### 数据契约

`data/products.json` — 最新快照（前端主数据）：

```json
{
  "updated_at": "2026-09-19T01:10:00.000Z",
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
- 纯静态，无构建步骤；Chart.js 使用 CDN（jsDelivr）。

### 部署

- **采集**：GitHub Actions 定时（主）+ 本机计划任务 / crontab（备）。
- **展示**：GitHub Pages 指向 `main` 分支的 `/docs` 目录。
- **教程**：根目录 `README.md`（中文）。

### 定时任务的可预期行为

GitHub 的 `schedule` 是尽力而为的，设计上必须假设它偶尔不触发：

- 定时只在**默认分支**、且 workflow 文件名**稳定**的前提下生效；重命名文件会重置注册。
- 避开整点（选 `01:10 UTC`），整点负载最高、最容易被丢弃。
- 仓库 60 天无活动会被自动停用定时；每日 bot commit 天然规避了这条。
- 因此保留 `workflow_dispatch` 手动入口，以及本机 `collect-and-push.bat` 作为备份执行器。

### 错误行为

| 场景 | 行为 |
|------|------|
| token 失效 | 重新获取 token 并重试该请求 1 次，再失败则整次任务失败退出码 1 |
| 某商品详情失败 | 记入 `errors` 字段继续其它商品，任务仍成功但日志警告 |
| 全部商品失败 | 任务失败，退出码 1，不写入坏数据 |
| 网络失败 | 3 次指数退避重试 |
| 自检不通过 | CI 中止，不 commit、不 push |
| 前端拉不到 JSON | 顶部横幅提示 + 重试按钮 |

## [S3] Out of Scope

- 下单、运费、售后、物流等接口。
- 多账号/多 App。
- 用户登录鉴权（Pages 公开或私有由仓库决定，页面本身无登录）。
- 实时推送/webhook 增量（先用每日全量）。
- 移动端深度适配（保证可读即可）。

## Tasks

- [x] T1: 采集脚本 `scripts/collect.js` — acceptance: 本地配置凭证后可跑通，生成 `data/products.json` 与 `data/history.json`，含真实代发价 (covers: S2)
- [x] T2: 静态页 `docs/` — acceptance: 打开列表可见已选品与涨跌，点击出现 SKU 趋势折线 (covers: S2)
- [x] T3: 定时采集与推送方案 — acceptance: GitHub Actions 每日 09:10 采集并推送；本机 `collect-and-push.bat` / crontab 作备份 (covers: S2)
- [x] T4: 运行教程 `README.md` — acceptance: 按文档可完成 Pages 配置与定时采集配置 (covers: S2)
- [x] T5: 本地端到端验证 — acceptance: 采集脚本成功写文件，静态页可渲染列表与图表 (covers: S2; depends: T1, T2)
- [x] T6: 产物自检 `scripts/selftest.js` — acceptance: 校验两份副本一致、字段完整、history 与快照对齐；CI 中在推送前执行 (covers: S2; depends: T1)
- [x] T7: 定时可靠性收敛 — acceptance: 删除测试探针 workflow；`price-sync.yml` 收敛为单一稳定文件、cron 改为每天一次避开整点；README/spec 说明 `schedule` 的已知限制与排查方法 (covers: S2)
