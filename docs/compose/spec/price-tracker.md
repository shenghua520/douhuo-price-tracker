---
feature: price-tracker
status: in-progress
updated: 2026-09-17
branch: feat/price-tracker
commits:
---

# 每日代发价采集与趋势网页

## Report

## [S1] Problem

运营需要每天盯住斗货商城后台「已选品」商品的代发价（`plat_price`）。目前只能进后台逐个看，无法：

1. 一页看到全部已选品的当前代发价；
2. 点开某个商品，看到历史价格趋势（是否涨价/降价）；
3. 在无人值守的情况下每日自动采集并更新。

## [S2] Design

### 架构

```
Gitee Go (每日定时)
  └─ scripts/collect.js
       ├─ getAccessToken
       ├─ getGoodsList (分页拉全量已选品)
       └─ getGoodsDetail (每个商品 SKU 的 plat_price)
            └─ 写入 data/products.json + data/history.json
                 └─ git commit & push

Gitee Pages (静态托管 site/)
  └─ 读取 ../data/products.json 与 history.json
       ├─ 商品列表（最新价、涨跌）
       └─ 点击商品 → Chart.js 趋势图
```

### 认证

- App ID / App Secret / 主账号手机号来自环境变量（本地 `.env`，CI 用 Gitee Go 变量）。
- sign = `md5(app_id + mobile + timestamp + app_secret)`，32 位小写十六进制。
- token 失效（`error_code != 0` 或接口报 token 过期）时自动重新获取并重试一次。
- 频控：接口限制 5 秒 80 次；采集脚本对详情请求做 80ms 间隔串行，远低于上限。

### 数据契约

`data/products.json` — 最新快照（前端主数据）：

```json
{
  "updated_at": "2026-09-17T11:00:00+08:00",
  "goods_count": 14,
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
      "prev_price": 18.00,
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
          { "date": "2026-09-16", "price": 18.0 },
          { "date": "2026-09-17", "price": 18.36 }
        ]
      }
    }
  }
}
```

- 同一天重复采集时覆盖当日点，不追加重复日期。
- 历史默认保留 180 天，超出按日期裁剪。

### 前端行为

- 打开页面自动拉 `products.json` + `history.json`；失败时提示并提供「重试」。
- 列表字段：缩略图、商品名、SPU 编码、当前最低代发价、较昨日涨跌（↑ 红 / ↓ 绿 / — 灰）、SKU 数、更新时间。
- 顶部搜索框按商品名/编码过滤；可按「有涨价」筛选。
- 点击行打开详情面板：
  - 每个 SKU 一张 Chart.js 折线图（日期 x，代发价 y）；
  - 显示当前价、首次价、最高、最低、涨跌额。
- 无历史或仅 1 个点时显示占位说明，不画空图报错。
- 纯静态，无构建步骤；Chart.js 使用 CDN（jsDelivr）。

### 部署

- **采集**：Gitee Go 工作流 `.gitee/workflows/collect.yml`，每日定时 + 手动触发；secrets 走仓库变量。
- **展示**：Gitee Pages 指向 `site/` 目录；页面通过相对路径 `../data/*.json` 或同源复制到 `site/data/` 读取。为兼容 Pages 根路径限制，采集脚本同步拷贝 JSON 到 `site/data/`。
- **教程**：根目录 `README.md`（中文），覆盖：Gitee 建仓、变量配置、Pages 开启、本地运行、常见错误。

### 错误行为

| 场景 | 行为 |
|------|------|
| token 失效 | 重新获取 token 并重试该请求 1 次，再失败则整次任务失败退出码 1 |
| 某商品详情失败 | 记入 `errors` 字段继续其它商品，任务仍成功但日志警告 |
| 网络失败 | 3 次指数退避重试 |
| 前端拉不到 JSON | 顶部横幅提示 + 重试按钮 |

## [S3] Out of Scope

- 下单、运费、售后、物流等接口。
- 多账号/多 App。
- 用户登录鉴权（Pages 公开或私有由仓库决定，页面本身无登录）。
- 实时推送/webhook 增量（先用每日全量）。
- 移动端深度适配（保证可读即可）。

## Tasks

- [x] T1: 采集脚本 `scripts/collect.js` — acceptance: 本地配置凭证后可跑通，生成 `data/products.json` 与 `data/history.json`，含真实代发价 (covers: S2)
- [x] T2: 静态页 `site/` — acceptance: 打开列表可见已选品与涨跌，点击出现 SKU 趋势折线 (covers: S2)
- [x] T3: Gitee Go 工作流 — acceptance: YAML 符合 Gitee Go cron 语法，读取 secrets，提交 data+site/data (covers: S2)
- [x] T4: 运行教程 `README.md` — acceptance: 按文档可在 Gitee 完成 Pages + 定时采集配置 (covers: S2)
- [x] T5: 本地端到端验证 — acceptance: 采集脚本成功写文件，静态页可渲染列表与图表（含 mock 兜底） (covers: S2; depends: T1, T2)
