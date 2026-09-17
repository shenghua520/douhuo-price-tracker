# 每日已选品代发价监控

盯住斗货商城后台**已选品**商品的代发价（`plat_price`），每日自动采集；打开网页看列表，点商品看价格趋势。

```
本机/服务器定时任务 → scripts/collect.js → data/*.json + site/data/*.json
                                              ↓
                                      git push 到 Gitee
                                              ↓
                                      Gitee Pages (site/)
                                              ↓
                                 列表 + 涨跌 + Chart.js 趋势图
```

---

## 功能

- 每日拉取全部已选品，记录每个 SKU 的代发价
- 概览卡片：在售数 / 今日涨价 / 今日降价 / 最大涨跌
- 列表展示当前最低价、较上次涨跌（红涨绿跌）、渠道标签
- 按渠道筛选、搜索、有涨价/有降价快捷筛选
- 顶部「涨价」提醒条，点数字一键筛出涨价商品
- 点击商品打开侧栏：每个 SKU 一张历史折线图
- 一键导出当前筛选结果为 CSV（含 BOM，Excel 可直接打开）

## 本地运行（先跑通）

### 1. 环境

- Node.js **≥ 18**（自带 `fetch`）
- 网络能访问 `https://www.douhuomall.com`

### 2. 配置凭证

复制示例环境变量：

```bat
copy .env.example .env
```

编辑 `.env`：

```env
DOUHUO_APP_ID=YS34AE0CDDC979295585
DOUHUO_APP_SECRET=你的AppSecret
DOUHUO_MOBILE=主账号手机号
```

> `.env` 已在 `.gitignore` 中，不会被提交。

### 3. 采集一次

```bat
npm run collect
```

成功后会生成/更新：

- `data/products.json` — 最新快照
- `data/history.json` — 按日历史
- `site/data/*.json` — 前端同源读取用副本

### 4. 打开网页

不要直接双击 `site/index.html`（浏览器会因 file:// 限制读不到 JSON）。请用静态服务：

```bat
npm run serve
```

浏览器打开 `http://localhost:5173`。

## 部署到 Gitee

> **架构说明**：Gitee 侧主要负责 **Pages 静态展示** 与 **代码托管**。  
> 「每日定时采集」推荐在 **本机/内网服务器** 用计划任务跑 `collect-and-push.bat`，再 push 到 Gitee。  
> Gitee 企业版流水线（Gitee Go）是 **纯 UI 编排**，不是 GitHub Actions 那种仓库内 YAML；若已开通企业版，也可在流水线界面加一个「执行脚本」任务运行采集（见下文 C）。

### A. 建仓并推送

1. 在 [gitee.com](https://gitee.com) 新建仓库（建议**公开**，便于 Pages）。
2. 将本项目推上去。注意：本地当前在 feature 分支时先合并到 `main`：

```bat
git checkout main
git merge feat/price-tracker
git remote add origin https://gitee.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

> 不要把 `.env` 推到 Gitee。密钥只放本机 `.env` 或流水线变量。

### B. 开启 Gitee Pages（展示）

1. 仓库 **服务 → Gitee Pages**
2. 部署目录尽量选择 **`site`**
3. 启动服务，访问分配的域名

**Pages 目录说明**

- 前端在 `site/`，数据副本在 `site/data/`，页面用相对路径 `data/*.json` 读取。
- 若你的 Gitee Pages **只能选仓库根目录**：把 `index.html` / `styles.css` / `app.js` 复制到仓库根，并让采集写入根目录 `data/`（或把 `site/data` 同步过去）；也可用 `docs/` 作为 Pages 根目录。

### C. 每日自动采集（推荐：本机计划任务）

这是**不依赖 Gitee 企业版**、最稳的方式。仓库根目录已有 `collect-and-push.bat`：

1. 确认本机 `.env` 已配置、`npm run collect` 能成功。
2. 注册 Windows 计划任务（每天 09:10）：

```bat
schtasks /Create /TN "DouhuoPriceCollect" /TR "C:\path\to\repo\collect-and-push.bat" /SC DAILY /ST 09:10
```

3. 需要时手动跑一次：

```bat
collect-and-push.bat
```

Linux 服务器 `crontab` 示例：

```cron
10 9 * * * cd /path/to/repo && node scripts/collect.js && git add data site/data && (git diff --staged --quiet || git commit -m "data: daily price snapshot" && git push)
```

### C2. 可选：Gitee 企业版流水线（UI 配置）

若公司已开通 **Gitee 企业版流水线**：

1. 项目 → 流水线 → 新建流水线
2. 触发：定时（cron 填 `10 9 * * *`，注意流水线时区是否为 UTC+8）
3. 变量：添加 `DOUHUO_APP_ID` / `DOUHUO_APP_SECRET` / `DOUHUO_MOBILE`
4. 任务：选择「执行脚本 / Shell」，内容大致为：

```bash
node scripts/collect.js
git add data site/data
git diff --staged --quiet || (git commit -m "data: daily price snapshot" && git push)
```

流水线运行身份需要有仓库写权限（可用机器人账号 / Deploy Key）。  
**本仓库不提供 `.gitee/workflows/*.yml`**：Gitee Go 当前以 UI 编排为主，与 GitHub Actions 语法不通用。

### D. 首次出图

历史趋势至少需要 **2 个不同日期** 的采集点。部署当天只有 1 个点时，列表有价、图区域显示「历史点不足」。再等一天后计划任务跑过第二次即可。

## 目录结构

```
.
├── scripts/collect.js       # 采集脚本（Node ≥ 18，无第三方依赖）
├── scripts/dev-server.js    # 本地静态服务
├── collect-and-push.bat     # Windows：采集 + 有变更则 commit/push
├── data/
│   ├── products.json        # 最新商品与价格快照
│   └── history.json         # 按日历史
├── site/
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   └── data/                # 前端读取的 JSON 副本
├── .env.example
└── README.md
```

## 接口与字段

| 步骤 | 接口 | 用途 |
|------|------|------|
| Token | `POST /api_v2/noAuth/getAccessToken` | sign=`md5(app_id+mobile+timestamp+app_secret)` |
| 列表 | `GET /api_v2/Goods/getGoodsList` | 已选品分页 |
| 详情 | `GET /api_v2/Goods/getGoodsDetail` | SKU 列表与 `plat_price` 代发价 |

注意：

- 频控约 5 秒 80 次；脚本串行且带间隔，默认远低于限制
- Token 失效会自动重取并重试一次
- 单商品详情失败会记入 `products.json.errors`，不影响其它商品

## 常见问题

**页面一直「数据加载失败」**  
多为直接打开了 `file://`。请用 `npm run serve` 或部署到 Pages。

**列表为空**  
确认供应链后台已「选品」，且 `status=1` 上架。先跑 `npm run collect` 看日志。

**涨跌显示「—」**  
当天首次采集或昨日无数据，属正常；有连续两天数据后会显示涨跌。

**App Secret 泄露风险**  
Secret 只放在本地 `.env` 或 Gitee 仓库密钥，不要写进前端 JS。

**Gitee 流水线没跑 / 找不到 YAML**  
Gitee Go 是 UI 编排，请在企业版流水线里配置定时与脚本；社区版请用本机 `collect-and-push.bat` 计划任务。

## 许可

内部运营工具，按需使用。
