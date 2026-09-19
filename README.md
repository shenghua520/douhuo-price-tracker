# 每日已选品代发价监控

盯住斗货商城后台**已选品**商品的代发价（`plat_price`），每天自动采集一次；打开网页看列表，点商品看价格趋势。

```
每天 09:10（北京时间）GitHub Actions 采价
  → 采集 + 自检 + 自动 commit & push
  → 更新 data/ 与 docs/data/

你随时打开网页看（只读已提交的 JSON）
```

**在线预览（GitHub Pages）**：https://shenghua520.github.io/douhuo-price-tracker/

定时没跑成功、或想立刻拉一次？见下面「手动兜底」。

---

## 成本：零

这个项目**不产生任何费用**：

| 项目 | 费用 | 说明 |
| --- | --- | --- |
| GitHub Actions | **免费** | 仓库是 public，公开仓库的 Actions 分钟数不限量、不计费 |
| GitHub Pages | **免费** | 公开仓库的静态托管免费 |
| Chart.js | **免费** | 走 jsDelivr 公共 CDN |
| 斗货接口 | **免费** | 用你自己的供应链账号，无额外接口费 |

每天只跑一次、约 1 分钟，公开仓库下这点用量完全免费。

> 前提是仓库保持 **public**。若改成 private，Actions 会开始计费（消耗 Free 计划的 2000 分钟/月额度，用量远低于上限，但就不再是「绝对零」了）。

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

成功后生成/更新：

- `data/products.json` — 最新快照
- `data/history.json` — 按日历史
- `docs/data/*.json` — 前端同源读取用副本

再跑一次自检，确认产物没问题：

```bat
npm run selftest
```

### 4. 打开网页

不要直接双击 `docs/index.html`（浏览器会因 file:// 限制读不到 JSON）。用静态服务：

```bat
npm run serve
```

浏览器打开 `http://localhost:5173`。Windows 上也可以直接双击 `打开本地网页.bat`。

---

## 自动采集

### 方式一：GitHub Actions（默认，已配置好）

工作流 `.github/workflows/price-sync.yml`，每天 **09:10（北京时间）** 自动跑一次：

1. `node scripts/collect.js` — 采集
2. `node scripts/selftest.js` — 自检产物，不通过就中止，不会把坏数据推上去
3. 有变化就 commit & push 回 `main`

**手动兜底**（定时没生效、或想立刻拉一次）：

- 网页：仓库 → Actions → `price-sync` → **Run workflow**
- 命令行：双击 `trigger-github-action.bat`（token 取自 `trigger-token.txt` 或 `.env` 里的 `GITHUB_TOKEN`）

### 方式二：本机计划任务（备用）

GitHub 的定时任务偶尔会延迟或漏跑，本机留一手更稳：

```bat
schtasks /Create /TN "DouhuoPriceCollect" /TR "C:\path\to\repo\collect-and-push.bat" /SC DAILY /ST 09:10
```

`collect-and-push.bat` 会采集 → 自检 → 提交 → 推送（带 rebase 重试），需要时手动双击也行。

Linux 服务器 `crontab`：

```cron
10 9 * * * cd /path/to/repo && node scripts/collect.js && node scripts/selftest.js && git add data docs/data && (git diff --staged --quiet || (git commit -m "data: price snapshot" && git push))
```

---

## 关于 GitHub 定时任务，几件必须知道的事

1. **`schedule` 是「尽力而为」的**。GitHub 在整点负载最高，定时任务会被延迟，负载足够高时**直接丢弃**。所以本工作流刻意选了 `01:10 UTC`（= `09:10` 北京），避开整点。
2. **改工作流文件名 = 重新注册定时**。每次重命名或新建 workflow 文件，GitHub 都要重新登记，期间不会触发。定下来之后尽量别改文件名。
3. **仓库 60 天没有任何活动，定时会被自动停用**。本项目每天有一次 bot commit，不会触发这条；但如果你停了采集很久，回来要手动跑一次把它「唤醒」。
4. **`schedule` 只在默认分支 `main` 上生效。**
5. **怎么排查**：仓库 → Actions → 左侧选中 `price-sync` → 看运行记录的触发来源。如果最近全是 `workflow_dispatch`、没有 `schedule`，就是定时没生效。

---

## 首次出图

历史趋势至少需要 **2 个不同日期** 的采集点。部署当天只有 1 个点时，列表有价、图区域显示「历史点不足」。等第二天自动跑过就有折线了。

---

## 目录结构

```
.
├── .github/workflows/
│   └── price-sync.yml        # 每天 09:10 采集 + 自检 + 推送
├── scripts/
│   ├── collect.js            # 采集脚本（Node ≥ 18，无第三方依赖）
│   ├── selftest.js           # 产物自检（数据契约校验）
│   └── dev-server.js         # 本地静态服务
├── collect-and-push.bat      # Windows：本机采集 + 有变更则 commit/push
├── trigger-github-action.bat # Windows：手动触发 GitHub 上的采集
├── 打开本地网页.bat           # Windows：起本地服务并打开浏览器
├── data/
│   ├── products.json         # 最新商品与价格快照
│   └── history.json          # 按日历史
├── docs/                     # GitHub Pages 根目录
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   └── data/                 # 前端读取的 JSON 副本
├── .gitattributes            # 统一换行符（避免 Windows/Linux 假 diff）
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

- 频控约 5 秒 80 次；脚本串行且带 80ms 间隔，远低于限制
- Token 失效会自动重取并重试一次
- 网络失败 3 次指数退避重试
- 单商品详情失败会记入 `products.json.errors`，不影响其它商品；只有全部商品都失败才让任务失败

## 常见问题

**页面一直「数据加载失败」**  
多为直接打开了 `file://`。请用 `npm run serve`，或打开 Pages 地址。

**列表为空**  
确认供应链后台已「选品」，且 `status=1` 上架。先跑 `npm run collect` 看日志。

**涨跌显示「—」**  
当天首次采集、或上次没有数据，属正常；有连续两天数据后就会显示涨跌。

**Actions 一直没自动跑**  
见上面「关于 GitHub 定时任务」那一节。先手动 Run workflow 确认流程本身是通的，再等定时生效。

**Pages 打不开 / 404**  
Settings → Pages → Source 选 `main` 分支、目录 `/docs`，保存后等一分钟重新构建。

**`npm run selftest` 报「两份副本不一致」**  
说明 `docs/data/` 没跟着更新。重新跑一次 `npm run collect` 即可；这也是 workflow 里会在推送前先自检的原因。

**App Secret 泄露风险**  
`.env`、`trigger-token.txt` 都在 `.gitignore` 里，不会被提交。仓库是 **public**，所以**千万不要**把 App Secret 写进代码、README 或 commit 信息。凭证只放两处：本地 `.env`，以及 GitHub 仓库的 Settings → Secrets and variables → Actions。若怀疑已泄露，去斗货后台重置 App Secret，再同步更新这两处。

## 许可

内部运营工具，按需使用。
