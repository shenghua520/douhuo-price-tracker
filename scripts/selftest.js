#!/usr/bin/env node
/**
 * 采集产物自检（零依赖）
 *
 * 校验 data/ 与 docs/data/ 里的快照是否符合前端与工作流依赖的数据契约。
 * 采集之后跑一遍，能立刻发现「副本没同步」「字段缺失」「历史点没落上」这类问题。
 *
 * 用法:  node scripts/selftest.js
 * 退出码: 0 = 全部通过, 1 = 存在失败项
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const COPIES = [
  {
    name: 'products.json',
    primary: path.join(ROOT, 'data', 'products.json'),
    mirror: path.join(ROOT, 'docs', 'data', 'products.json'),
  },
  {
    name: 'history.json',
    primary: path.join(ROOT, 'data', 'history.json'),
    mirror: path.join(ROOT, 'docs', 'data', 'history.json'),
  },
];

let passCount = 0;
let failCount = 0;
const warnings = [];

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function run(name, fn) {
  try {
    const detail = fn();
    passCount += 1;
    console.log(`  PASS  ${name}${detail ? `  (${detail})` : ''}`);
  } catch (err) {
    failCount += 1;
    console.error(`  FAIL  ${name}  ->  ${err.message}`);
  }
}

function rel(p) {
  return path.relative(ROOT, p).replace(/\\/g, '/');
}

function readJson(file) {
  assert(fs.existsSync(file), `文件不存在: ${rel(file)}`);
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${rel(file)} 不是合法 JSON: ${err.message}`);
  }
}

function isDate(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v));
}

console.log('[selftest] 校验采集产物');

// ---- 1. data/ 与 docs/data/ 两份副本必须完全一致 ----
run('data/ 与 docs/data/ 两份副本字节一致', () => {
  for (const c of COPIES) {
    assert(fs.existsSync(c.primary), `缺少 ${rel(c.primary)}`);
    assert(fs.existsSync(c.mirror), `缺少 ${rel(c.mirror)}`);
    const a = fs.readFileSync(c.primary);
    const b = fs.readFileSync(c.mirror);
    if (!a.equals(b)) {
      throw new Error(
        `${c.name}: data/ 与 docs/data/ 内容不一致 —— 前端页面读的是 docs/data/，会展示旧数据`
      );
    }
  }
  return `${COPIES.length} 对副本一致`;
});

// ---- 2. products.json 顶层结构 ----
let products = null;
run('products.json 顶层结构合法', () => {
  products = readJson(COPIES[0].primary);
  assert(products && typeof products === 'object' && !Array.isArray(products), '根节点应为对象');
  assert(isDate(products.date), `date 应为 YYYY-MM-DD，实际为 ${JSON.stringify(products.date)}`);
  assert(Array.isArray(products.goods), 'goods 应为数组');
  assert(Number.isInteger(products.goods_count), 'goods_count 应为整数');
  assert(
    products.goods_count === products.goods.length,
    `goods_count=${products.goods_count} 与 goods.length=${products.goods.length} 不一致`
  );
  assert(Array.isArray(products.errors), 'errors 应为数组');
  assert(
    Number.isInteger(products.error_count) && products.error_count === products.errors.length,
    `error_count=${products.error_count} 与 errors.length=${products.errors.length} 不一致`
  );
  return `${products.goods.length} 个商品 / ${products.error_count} 个错误 / 日期 ${products.date}`;
});

// ---- 3. 每个商品的字段 ----
run('每个商品与其规格字段完整', () => {
  assert(products, 'products.json 未通过上一步校验');
  const problems = [];
  for (const g of products.goods) {
    if (g.goods_id === undefined || g.goods_id === null) {
      problems.push('存在缺少 goods_id 的商品');
      continue;
    }
    if (!g.goods_name) problems.push(`goods_id=${g.goods_id} 缺少 goods_name`);
    if (!Array.isArray(g.skus)) {
      problems.push(`goods_id=${g.goods_id} 的 skus 不是数组`);
      continue;
    }
    for (const s of g.skus) {
      if (s.sku_id === undefined || s.sku_id === null) {
        problems.push(`goods_id=${g.goods_id} 存在无 sku_id 的规格`);
      }
      if (s.price !== null && !Number.isFinite(s.price)) {
        problems.push(`goods_id=${g.goods_id} sku=${s.sku_id} 的 price 既非数字也非 null`);
      }
    }
  }
  assert(problems.length === 0, `${problems.length} 处问题: ${problems.slice(0, 3).join('; ')}`);
  return '全部通过';
});

// ---- 4. history.json 顶层结构 ----
let history = null;
run('history.json 顶层结构合法', () => {
  history = readJson(COPIES[1].primary);
  assert(
    history && typeof history === 'object' && !Array.isArray(history),
    '根节点应为以 goods_id 为键的对象'
  );
  const n = Object.keys(history).length;
  assert(n > 0, 'history 为空，趋势图将没有任何数据');
  return `${n} 个商品有历史`;
});

// ---- 5. 有价格的规格，在 history 里必须有当日点且价格一致 ----
run('当日快照与 history 价格点对齐', () => {
  assert(products && history, '前置校验未通过');
  const date = products.date;
  const missing = [];
  let matched = 0;
  for (const g of products.goods) {
    const priced = (g.skus || []).filter((s) => Number.isFinite(s.price));
    if (priced.length === 0) continue;
    const hg = history[String(g.goods_id)];
    if (!hg || !hg.skus) {
      missing.push(`${g.goods_id} 完全没有历史条目`);
      continue;
    }
    for (const s of priced) {
      const hs = hg.skus[String(s.sku_id)];
      const pt = hs && Array.isArray(hs.points) ? hs.points.find((p) => p.date === date) : null;
      if (!pt) {
        missing.push(`${g.goods_id}/${s.sku_id} 缺少 ${date} 的价格点`);
      } else if (pt.price !== s.price) {
        missing.push(`${g.goods_id}/${s.sku_id} 价格不一致 (history ${pt.price} vs 快照 ${s.price})`);
      } else {
        matched += 1;
      }
    }
  }
  assert(missing.length === 0, `${missing.length} 处对不上: ${missing.slice(0, 3).join('; ')}`);
  return `${matched} 个规格点已对齐到 ${date}`;
});

// ---- 6. 历史点日期格式正确、严格递增（同日不可重复） ----
run('history 时间点格式正确且严格递增', () => {
  assert(history, '前置校验未通过');
  const problems = [];
  let total = 0;
  for (const [gid, g] of Object.entries(history)) {
    for (const [sid, s] of Object.entries(g.skus || {})) {
      const pts = Array.isArray(s.points) ? s.points : [];
      total += pts.length;
      for (let i = 0; i < pts.length; i++) {
        if (!isDate(pts[i].date)) {
          problems.push(`${gid}/${sid} 日期格式异常: ${JSON.stringify(pts[i].date)}`);
        } else if (i > 0 && pts[i - 1].date >= pts[i].date) {
          problems.push(`${gid}/${sid} 日期未严格递增或同日重复 (${pts[i - 1].date} -> ${pts[i].date})`);
        }
        if (!Number.isFinite(pts[i].price)) {
          problems.push(`${gid}/${sid} 在 ${pts[i].date} 的价格不是数字`);
        }
      }
    }
  }
  assert(problems.length === 0, `${problems.length} 处问题: ${problems.slice(0, 3).join('; ')}`);
  return `${total} 个历史点有序`;
});

// ---- 7. 时效提醒（只提醒，不算失败） ----
run('快照时效检查', () => {
  assert(products, '前置校验未通过');
  const beijingToday = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  if (products.date !== beijingToday) {
    warnings.push(
      `快照日期是 ${products.date}，北京时间今天已是 ${beijingToday} —— 定时任务可能没跑，或本地数据未更新`
    );
    return `快照 ${products.date} 早于今天 ${beijingToday}`;
  }
  return `快照日期 ${products.date} 就是今天`;
});

console.log(`\n[selftest] 通过 ${passCount} 项，失败 ${failCount} 项`);
for (const w of warnings) console.warn(`[selftest] 提醒: ${w}`);

if (failCount > 0) {
  console.error('[selftest] 自检未通过');
  process.exit(1);
}
console.log('[selftest] 全部通过');
