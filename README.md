# 每日已选品代发价监控

盯住斗货商城后台**已选品**商品的代发价（`plat_price`），自动采集；打开网页看列表，点商品看价格趋势。

```
每天 09:17（北京时间）GitHub Actions 兜底采价
  → 采集 + 自检 + 自动 commit & push
  → 更新 data/ 与 docs/data/

想立刻拉一次？打开网页点右上角「刷新」即可（触发 GitHub Actions）
```

**在线预览（GitHub Pages）**：https://shenghua520.github.io/douhuo-price-tracker/

---

## 成本：零

这个项目**不产生任何费用**：

| 项目 | 费用 | 说明 |
| --- | --- | --- |
| GitHub Actions | **免费** | 仓库是 public，公开仓库的 Actions 分钟数不限量、不计费 |
| GitHub Pages | **免费** | 公开仓库的静态托管免费 |
| Chart.js | **免费** | 走 jsDelivr 公共 CDN |
| 斗货接口 | **免费** | 用你自己的供应链账号，无额外接口费 |

**所以：点多少次「刷新」都是 ¥0。** 网页会做时间间隔限制（冷却），目的不是省钱，而是别把斗货接口刷爆、别堆一堆没意义的提交。

> 前提是仓库保持 **public**。若改成 private，Actions 会开始计费（消耗 Free 计划的 2000 分钟/月额度，用量远低于上限，但就不再是「绝对零」了）。

---

## 功能

- 每日拉取全部已选品，记录每个 SKU 的代发价
- **网页点「刷新」→ 立即触发一次采价**（授权一次即可，见下文）
- 概览卡片：在售数 / 今日涨价 / 今日降价 / 最大涨跌
- 列表展示当前最低价、较上次涨跌（红涨绿跌）、渠道标签
- 按渠道筛选、搜索、有涨价/有降价快捷筛选
- 顶部「涨价」提醒条，点数字一键筛出涨价商品
- 点击商品打开侧栏：每个 SKU 一张历史折线图
- 一键导出当前筛选结果为 CSV（含 BOM，Excel 可直接打开）

---

## 网页上的「刷新」按钮是怎么工作的

**先说结论：网页自己采不了价。** 两个硬原因：

1. **斗货接口不允许跨域（CORS）**。浏览器从网页直接请求斗货接口会被同源策略拦下——实测确认它不返回任何跨域放行头。
2. **密钥不能放进网页**。静态网页的代码是公开的，把 App Secret 写在里面等于公开。

所以「刷新」的定位不是自己干活，而是**通知 GitHub 那台免费机器去采价**：

```
点「刷新」→ 浏览器带令牌请求 GitHub API
        → GitHub Actions 启动（免费机器）
        → 用存在 Secrets 里的斗货密钥采价
        → 写入 data/ 与 docs/data/ 并提交
        → 页面轮询到完成，自动重新加载
```

GitHub 的 API 允许浏览器跨域调用（实测 `Access-Control-Allow-Origin: *`，且放行 `POST` 与 `Authorization` 头），所以这条路可行。

### 令牌怎么准备

网页需要的是一个 **GitHub 令牌**（不是斗货密钥）。点「刷新」时会弹窗让你粘贴一次，之后存在**你本机浏览器**里，不用再输。

推荐用 **Fine-grained token**（GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens）：

- **Repository access**：只勾这一个仓库
- **Permissions → Actions**：`Read and write`
- 其它一律不勾

若用经典 token（classic），勾选 `workflow` 即可（会连带 `repo`，权限大得多，不推荐）。

### 安全边界（重要）

| 信息 | 存在哪 | 会不会公开 |
| --- | --- | --- |
| `DOUHUO_APP_SECRET` 等斗货凭证 | GitHub 仓库 **Secrets（加密）** | **不会**。GitHub 存进去后连你自己都读不出来（API 只返回名字），日志里出现会自动打码成 `***` |
| 你粘贴的 **GitHub 令牌** | **你本机瀏览器的 localStorage** | **不会**上传，也不会提交到仓库 |
| `data/*.json`（价格数据） | 仓库（公开） | 会公开——这里只有商品与价格，没有凭证 |

**即便 GitHub 令牌泄露，损失也很有限**：按上面的最小权限配置，别人最多能重复触发这个仓库的采价任务，**读不到仓库里的密钥，也动不了其他仓库**。随时可在 GitHub 上一键吊销。

> ⚠️ **绝不要**把令牌或斗货密钥写进 `docs/` 下任何文件、README 或 commit 信息——仓库是公开的，那才会真泄露。弹窗里也有「清除本机已保存的令牌」按钮。

### 冷却间隔

`docs/app.js` 顶部：

```js
const COOLDOWN_MS = 10 * 60 * 1000; // 生产：10 分钟
const COOLDOWN_ENABLED = false;     // 测试阶段先关闭限制
```

测试完想启用冷却，把 `COOLDOWN_ENABLED` 改成 `true` 即可。

---

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

### 主力：网页「刷新」按钮

见上一节。任何设备（含手机）打开 Pages 页面，点一下就能立刻采一次——这是目前**最可靠**的触发方式。

### 兜底一：GitHub Actions 定时

工作流 `.github/workflows/price-sync.yml`，每天 **09:17（北京时间）** 跑一次：

1. `node scripts/collect.js` — 采集
2. `node scripts/selftest.js` — 自检产物，不通过就中止，不会把坏数据推上去
3. 有变化就 commit & push 回 `main`

**手动兜底**（想立刻拉一次、或定时没生效）：

- 网页：仓库 → Actions → `price-sync` → **Run workflow**
- 命令行：双击 `trigger-github-action.bat`（token 取自 `trigger-token.txt` 或 `.env` 里的 `GITHUB_TOKEN`）

### 兜底二：本机计划任务（备用）

```bat
schtasks /Create /TN "DouhuoPriceCollect" /TR "C:\path\to\repo\collect-and-push.bat" /SC DAILY /ST 09:17
```

`collect-and-push.bat` 会采集 → 自检 → 提交 → 推送（带 rebase 重试），需要时手动双击也行。

Linux 服务器 `crontab`：

```cron
17 9 * * * cd /path/to/repo && node scripts/collect.js && node scripts/selftest.js && git add data docs/data && (git diff --staged --quiet || (git commit -m "data: price snapshot" && git push))
```

---

## 关于 GitHub 定时任务，几件必须知道的事

1. **`schedule` 是「尽力而为」的，而且可能长期不触发。** GitHub 在整点负载最高，定时任务会被延迟，负载足够高时**直接丢弃**。
   > **本仓库的实测结论**：曾把 cron 改成 `*/10 * * * *`（每 10 分钟）连续观察 **8 小时**，**48 次机会、0 次触发**，所有运行都是手动 `workflow_dispatch`。仓库设置全部正常（public / 未归档 / Actions 已开启 / 默认分支 `main`），所以这是 GitHub 侧的不可靠，不是配置问题。
   > **因此本项目不把定时当主力**，定时只作兜底；要立刻采价请点网页上的「刷新」。想验证定时到底生效没，看 Actions 里有没有事件来源是 `schedule` 的运行。
2. **改工作流文件名 = 重新注册定时。** 每次重命名或新建 workflow 文件，GitHub 都要重新登记，期间不会触发。定下来之后尽量别改文件名。
3. **仓库 60 天没有任何活动，定时会被自动停用。** 本项目每天有一次 bot commit，不会触发这条；但如果你停了采集很久，回来要手动跑一次把它「唤醒」。
4. **`schedule` 只在默认分支 `main` 上生效。**
5. **时区**：cron 用 **UTC**。北京 09:17 = UTC 01:17，刻意避开整点。

---

## 首次出图

历史趋势至少需要 **2 个不同日期** 的采集点。部署当天只有 1 个点时，列表有价、图区域显示「历史点不足」。等第二天自动跑过就有折线了。

---

## 目录结构

```
.
├── .github/workflows/
│   └── price-sync.yml        # 每天 09:17 采集 + 自检 + 推送（兜底）
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
│   ├── app.js                # 含「刷新 → 触发 GitHub Actions」逻辑
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

**点「刷新」弹窗，粘贴令牌后仍失败**  
看提示：401 = 令牌无效/过期（会清掉，重输）；403 = 权限不足，需该仓库的 `Actions: Read and write`（经典 token 要勾 `workflow`）；404 = 令牌没授权到这个仓库。

**不想用令牌了**  
弹窗里点「清除本机已保存的令牌」；或浏览器清空本站点数据。

**列表为空**  
确认供应链后台已「选品」，且 `status=1` 上架。先跑 `npm run collect` 看日志。

**涨跌显示「—」**  
当天首次采集、或上次没有数据，属正常；有连续两天数据后就会显示涨跌。

**Actions 定时一直没自动跑**  
见「关于 GitHub 定时任务」一节——本仓库实测过定时不可靠，请用网页「刷新」。先手动 Run workflow 确认流程本身是通的。

**Pages 打不开 / 404**  
Settings → Pages → Source 选 `main` 分支、目录 `/docs`，保存后等一分钟重新构建。

**`npm run selftest` 报「两份副本不一致」**  
说明 `docs/data/` 没跟着更新。重新跑一次 `npm run collect` 即可；这也是 workflow 里会在推送前先自检的原因。

**App Secret / 令牌泄露风险**  
`.env`、`trigger-token.txt` 都在 `.gitignore` 里，不会被提交。仓库是 **public**，所以**千万不要**把 App Secret 或任何令牌写进代码、README 或 commit 信息。凭证只放两处：本地 `.env`，以及 GitHub 仓库的 Settings → Secrets and variables → Actions。若怀疑已泄露，去斗货后台重置 App Secret、并在 GitHub 上吊销令牌，再同步更新。

## 许可

内部运营工具，按需使用。
