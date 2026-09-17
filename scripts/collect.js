#!/usr/bin/env node
/**
 * 斗货商城已选品代发价每日采集
 * 依赖：Node.js >= 18（内置 fetch / crypto）
 * 环境变量：
 *   DOUHUO_APP_ID, DOUHUO_APP_SECRET, DOUHUO_MOBILE
 * 可选：DOUHUO_BASE_URL（默认 https://www.douhuomall.com）
 * 可选：HISTORY_DAYS（默认 180）
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE_URL = (process.env.DOUHUO_BASE_URL || 'https://www.douhuomall.com').replace(/\/$/, '');
const APP_ID = process.env.DOUHUO_APP_ID || '';
const APP_SECRET = process.env.DOUHUO_APP_SECRET || '';
const MOBILE = process.env.DOUHUO_MOBILE || '';
const HISTORY_DAYS = Number(process.env.HISTORY_DAYS || 180);

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const SITE_DATA_DIR = path.join(ROOT, 'docs', 'data');
const PRODUCTS_PATH = path.join(DATA_DIR, 'products.json');
const HISTORY_PATH = path.join(DATA_DIR, 'history.json');

function loadEnvFile() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env) || process.env[key] === '') {
      process.env[key] = val;
    }
  }
}

loadEnvFile();

function fail(msg) {
  console.error(`[collect] ERROR: ${msg}`);
  process.exit(1);
}

if (!process.env.DOUHUO_APP_ID) process.env.DOUHUO_APP_ID = APP_ID;
if (!process.env.DOUHUO_APP_SECRET) process.env.DOUHUO_APP_SECRET = APP_SECRET;
if (!process.env.DOUHUO_MOBILE) process.env.DOUHUO_MOBILE = MOBILE;

const cfgAppId = process.env.DOUHUO_APP_ID;
const cfgAppSecret = process.env.DOUHUO_APP_SECRET;
const cfgMobile = process.env.DOUHUO_MOBILE;

if (!cfgAppId || !cfgAppSecret || !cfgMobile) {
  fail(
    '缺少凭证。请设置 DOUHUO_APP_ID / DOUHUO_APP_SECRET / DOUHUO_MOBILE，或在项目根目录创建 .env'
  );
}

function md5Lower(str) {
  return crypto.createHash('md5').update(str, 'utf8').digest('hex');
}

function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function httpJson(url, options = {}, retries = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(options.headers || {}),
        },
      });
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`非 JSON 响应 HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      return json;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const wait = 500 * Math.pow(2, attempt - 1);
        console.warn(`[collect] 请求失败(第${attempt}次) ${err.message}，${wait}ms 后重试`);
        await sleep(wait);
      }
    }
  }
  throw lastErr;
}

let cachedToken = null;

async function fetchToken() {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sign = md5Lower(`${cfgAppId}${cfgMobile}${timestamp}${cfgAppSecret}`);
  const body = JSON.stringify({
    app_id: cfgAppId,
    sign,
    mobile: cfgMobile,
    timestamp,
  });
  const url = `${BASE_URL}/api_v2/noAuth/getAccessToken`;
  const json = await httpJson(url, { method: 'POST', body });
  if (json.error_code !== 0 || !json.result?.access_token) {
    throw new Error(`获取 token 失败: ${json.error_code} ${json.error_msg}`);
  }
  cachedToken = json.result.access_token;
  console.log('[collect] token ok, expire=', json.result.expire_date_time);
  return cachedToken;
}

async function getToken() {
  if (!cachedToken) await fetchToken();
  return cachedToken;
}

function isTokenError(json) {
  if (!json) return true;
  if (json.error_code === 0) return false;
  const msg = String(json.error_msg || '');
  return (
    /token|密钥|凭证|过期|失效|未授权|登录/i.test(msg) ||
    json.error_code === 40001 ||
    json.error_code === 40003 ||
    json.error_code === 10001 ||
    json.error_code === 10003
  );
}

async function apiGet(pathname, params, retried = false) {
  const token = await getToken();
  const qs = new URLSearchParams({ access_token: token, ...cleanParams(params) });
  const url = `${BASE_URL}${pathname}?${qs.toString()}`;
  const json = await httpJson(url, { method: 'GET' });
  if (isTokenError(json) && !retried) {
    console.warn('[collect] token 疑似失效，重新获取后重试');
    await fetchToken();
    return apiGet(pathname, params, true);
  }
  if (json.error_code !== 0) {
    const err = new Error(`${pathname} 失败: ${json.error_code} ${json.error_msg}`);
    err.json = json;
    throw err;
  }
  return json.result;
}

function cleanParams(params = {}) {
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    out[k] = String(v);
  }
  return out;
}

function attrText(attr) {
  if (!Array.isArray(attr) || attr.length === 0) return '';
  return attr.map((a) => a?.val || a?.name || '').filter(Boolean).join(' / ');
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function readJsonSafe(p, fallback) {
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.warn(`[collect] 读取 ${p} 失败，使用空数据: ${e.message}`);
  }
  return fallback;
}

function writeJson(p, data) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function pruneHistory(history, days) {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (days - 1));
  const cutoffStr = todayStr(cutoff);
  for (const goods of Object.values(history)) {
    if (!goods?.skus) continue;
    for (const sku of Object.values(goods.skus)) {
      if (!Array.isArray(sku.points)) continue;
      sku.points = sku.points.filter((pt) => pt.date >= cutoffStr);
      sku.points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    }
  }
  return history;
}

async function collectAllGoodsList() {
  const all = [];
  let page = 1;
  const limit = 100;
  let total = 0;
  let pages = 1;
  do {
    const result = await apiGet('/api_v2/Goods/getGoodsList', {
      page,
      limit,
      status: 1,
    });
    total = result.total || 0;
    pages = result.pages || 1;
    const list = result.list || [];
    all.push(...list);
    console.log(`[collect] 商品列表 page=${page}/${pages} 累计=${all.length}/${total}`);
    if (list.length === 0) break;
    page += 1;
    if (page > pages) break;
    await sleep(80);
  } while (page <= pages);
  return all;
}

async function fetchGoodsDetail(goodsId) {
  // status=0 取全部下属 SKU；limit=100 覆盖多规格
  let page = 1;
  const limit = 100;
  let head = null;
  const skus = [];
  let pages = 1;
  do {
    const result = await apiGet('/api_v2/Goods/getGoodsDetail', {
      goods_id: goodsId,
      status: 0,
      page,
      limit,
      type: 0,
    });
    if (!head) head = result;
    pages = result.pages || 1;
    if (Array.isArray(result.sku_list)) skus.push(...result.sku_list);
    if (result.sku_list?.length === 0 && page === 1) break;
    page += 1;
    await sleep(80);
  } while (page <= pages);
  return { head, skus };
}

function prevPriceOf(history, goodsId, skuId, today) {
  const pts = history?.[goodsId]?.skus?.[skuId]?.points;
  if (!Array.isArray(pts)) return null;
  let prev = null;
  for (const pt of pts) {
    if (pt.date < today) prev = pt;
  }
  // 同日已有点不算「昨日」
  return prev ? prev.price : null;
}

function upsertHistory(history, goods, skus, today) {
  const gid = String(goods.goods_id);
  if (!history[gid]) {
    history[gid] = {
      name: goods.goods_name || goods.spu_name || '',
      skus: {},
    };
  }
  history[gid].name = goods.goods_name || goods.spu_name || history[gid].name || '';
  for (const sku of skus) {
    const sid = String(sku.sku_id);
    const price = Number(sku.plat_price ?? sku.cost_price);
    if (!Number.isFinite(price)) continue;
    if (!history[gid].skus[sid]) {
      history[gid].skus[sid] = {
        attr: attrText(sku.attr) || sku.sku_name || '',
        points: [],
      };
    }
    const bucket = history[gid].skus[sid];
    bucket.attr = attrText(sku.attr) || sku.sku_name || bucket.attr;
    const idx = bucket.points.findIndex((p) => p.date === today);
    if (idx >= 0) {
      bucket.points[idx] = { date: today, price };
    } else {
      bucket.points.push({ date: today, price });
      bucket.points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    }
  }
}

async function main() {
  console.log('[collect] start', new Date().toISOString());
  ensureDir(DATA_DIR);
  ensureDir(SITE_DATA_DIR);

  const history = readJsonSafe(HISTORY_PATH, {});
  const today = todayStr();
  const errors = [];

  const list = await collectAllGoodsList();
  console.log(`[collect] 已选品总数=${list.length}`);

  const goodsOut = [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const gid = item.goods_id;
    process.stdout.write(`[collect] (${i + 1}/${list.length}) goods_id=${gid} `);
    try {
      const { head, skus } = await fetchGoodsDetail(gid);
      const activeSkus = (skus || []).filter((s) => Number(s.status) !== 3);
      const priceSkus = activeSkus
        .map((s) => {
          const price = Number(s.plat_price ?? s.cost_price);
          const prev = Number.isFinite(price) ? prevPriceOf(history, String(gid), String(s.sku_id), today) : null;
          return {
            sku_id: s.sku_id,
            sku_name: s.sku_name || '',
            attr_text: attrText(s.attr),
            price: Number.isFinite(price) ? price : null,
            retail_price: Number.isFinite(Number(s.retail_price)) ? Number(s.retail_price) : null,
            status: Number(s.status ?? 1),
            prev_price: prev,
          };
        })
        .filter((s) => s.price !== null || s.status === 1);

      const prices = priceSkus.map((s) => s.price).filter((p) => Number.isFinite(p));
      const minPrice = prices.length ? Math.min(...prices) : null;
      const maxPrice = prices.length ? Math.max(...prices) : null;
      // 商品级涨跌：用当前最低价的那条 SKU 与它自己的昨日价比较
      const minSku = priceSkus
        .filter((s) => Number.isFinite(s.price))
        .sort((a, b) => a.price - b.price)[0];
      let priceChange = null;
      let priceChangePct = null;
      let prevPrice = null;
      if (minSku && Number.isFinite(minSku.prev_price)) {
        prevPrice = minSku.prev_price;
        priceChange = Math.round((minSku.price - minSku.prev_price) * 100) / 100;
        if (minSku.prev_price !== 0) {
          priceChangePct = Math.round((priceChange / minSku.prev_price) * 10000) / 100;
        }
      }

      upsertHistory(
        history,
        {
          goods_id: gid,
          goods_name: item.goods_name || head?.spu_name,
        },
        activeSkus.filter((s) => Number.isFinite(Number(s.plat_price ?? s.cost_price))),
        today
      );

      goodsOut.push({
        goods_id: gid,
        goods_name: item.goods_name || head?.spu_name || '',
        spu_sn: item.spu_sn || head?.spu_sn || '',
        main_img: head?.main_img || activeSkus[0]?.main_img || '',
        status: Number(item.status ?? head?.status ?? 1),
        supply_type: Number(item.supply_type ?? head?.supply_type ?? 0),
        sku_count: priceSkus.length,
        min_price: minPrice,
        max_price: maxPrice,
        prev_price: prevPrice,
        price_change: priceChange,
        price_change_pct: priceChangePct,
        skus: priceSkus,
      });
      console.log(`ok sku=${priceSkus.length} min=${minPrice}`);
    } catch (err) {
      console.log(`FAIL: ${err.message}`);
      errors.push({ goods_id: gid, goods_name: item.goods_name, error: err.message });
    }
    if (i < list.length - 1) await sleep(80);
  }

  // 有涨价的排前面，其次按名称
  goodsOut.sort((a, b) => {
    const ac = a.price_change === null ? -Infinity : a.price_change;
    const bc = b.price_change === null ? -Infinity : b.price_change;
    if (ac !== bc) return bc - ac;
    return String(a.goods_name).localeCompare(String(b.goods_name), 'zh');
  });

  const products = {
    updated_at: new Date().toISOString(),
    date: today,
    goods_count: goodsOut.length,
    error_count: errors.length,
    errors,
    goods: goodsOut,
  };

  const pruned = pruneHistory(history, HISTORY_DAYS);

  writeJson(PRODUCTS_PATH, products);
  writeJson(HISTORY_PATH, pruned);
  writeJson(path.join(SITE_DATA_DIR, 'products.json'), products);
  writeJson(path.join(SITE_DATA_DIR, 'history.json'), pruned);

  console.log(
    `[collect] done goods=${goodsOut.length} errors=${errors.length} → data/ 与 docs/data/`
  );
  if (errors.length && goodsOut.length === 0) {
    fail('全部商品采集失败');
  }
}

main().catch((err) => {
  fail(err.stack || err.message);
});
