# 每日已选品代发价监控

盯住斗货商城后台**已选品**商品的代发价（`plat_price`），每日自动采集；打开网页看列表，点商品看价格趋势。

```
Gitee Go 定时 → scripts/collect.js → data/*.json + site/data/*.json
                                      ↓
                              Gitee Pages (site/)
                                      ↓
                         列表 + 涨跌 + Chart.js 趋势图
```

---

## 功能

- 每日拉取全部已选品，记录每个 SKU 的代发价
- 列表展示当前最低价、较上次涨跌（红涨绿跌）
- 点击商品打开侧栏：每个 SKU 一张历史折线图
- 支持搜索、筛选「有涨价 / 有降价」

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

### A. 建仓并推送

1. 在 [gitee.com](https://gitee.com) 新建仓库（建议公开，便于 Pages）。
2. 本地推送：

```bat
git remote add origin https://gitee.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

若你正在 feature 分支开发，可先合并到 `main` 再推。

### B. 配置密钥（Gitee Go）

仓库 **设置 → 管理 → 变量/密钥**（或流水线密钥）添加：

| 名称 | 值 |
|------|-----|
| `DOUHUO_APP_ID` | 你的 App ID |
| `DOUHUO_APP_SECRET` | 你的 App Secret |
| `DOUHUO_MOBILE` | 主账号手机号 |

### C. 开启每日采集

工作流文件：`.gitee/workflows/collect.yml`

- 默认每天定时执行一次，并支持手动触发（`workflow_dispatch`）
- 执行内容：Node 采集 → 若 JSON 有变化则 commit & push

**若 Gitee Go 不可用**（未开通流水线/套餐不含），备选：

1. **本机计划任务**（Windows）— 每天跑一次并推送：

```bat
schtasks /Create /TN "DouhuoPriceCollect" /TR "cmd /c cd /d C:\path\to\repo && npm run collect && git add data site/data && git commit -m data && git push" /SC DAILY /ST 09:10
```

或使用仓库根目录已提供的 `collect-and-push.bat`（采集 + 有变更则 commit/push），再挂计划任务。

2. 自有一台 Linux 服务器：`crontab` 示例：

```cron
10 9 * * * cd /path/to/repo && /usr/bin/node scripts/collect.js && git add data site/data && git commit -m "data: daily price snapshot" || true && git push
```

### D. 开启 Gitee Pages

1. 仓库 **服务 → Gitee Pages**
2. 部署目录选择 **`site`**（若界面只允许选分支根目录，可把 Pages 指到 `site` 子目录；个别套餐只支持根目录——此时可把 `site/` 内容挪到仓库根或用 `docs/` 目录，见下文「Pages 目录说明」）
3. 启动服务，访问分配的域名

**Pages 目录说明**

- 本项目静态资源在 `site/`，数据副本在 `site/data/`，页面用相对路径 `data/*.json` 读取。
- 若你的 Gitee Pages **只能选仓库根目录**：把 `index.html` / `styles.css` / `app.js` 放到仓库根，并让采集脚本写入根目录 `data/`（或把 `site/data` 同步到根 `data/`）。也可把前端改放到 `docs/` 并把 Pages 指到 `docs`。

### E. 首次出图

历史趋势至少需要 **2 个不同日期** 的采集点。部署当天只有 1 个点时，列表有价、图区域显示「历史点不足」。再等一天或本地多跑几次（改系统日期不必要，脚本按自然日覆盖同日点）。

## 目录结构

```
.
├── scripts/collect.js       # 采集脚本（Node ≥ 18，无第三方依赖）
├── data/
│   ├── products.json        # 最新商品与价格快照
│   └── history.json         # 按日历史
├── site/
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   └── data/                # 前端读取的 JSON 副本
├── .gitee/workflows/collect.yml
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

**Gitee Go 没跑**  
检查流水线是否开通、cron 语法、secrets 名称是否完全一致。可先用「手动运行」验证。

## 许可

内部运营工具，按需使用。
