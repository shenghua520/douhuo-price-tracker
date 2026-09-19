/* 已选品代发价监控 — 纯静态前端 */
(function () {
  'use strict';

  const DATA_BASE = 'data';
  const CHANNELS = {
    1: '京东',
    4: '云商特卖',
    5: '厂商特卖',
    7: '微唯宝特卖',
    10: '华南一仓',
    12: '华南二仓',
    13: '3C家电',
    14: '新疆专场',
    15: '西藏专场',
    16: '内蒙专场',
    17: '华东一仓',
    18: '企业专属',
  };

  // ===== 采价触发（网页 → GitHub Actions）=====
  // 网页自身采不了价：斗货接口不允许浏览器跨域，密钥也不能放进公开的网页。
  // 因此「刷新」的作法是：带上你自己的 GitHub 令牌，通知 GitHub 去跑采价工作流。
  const REPO = {
    owner: 'shenghua520',
    repo: 'douhuo-price-tracker',
    workflow: 'price-sync.yml',
    ref: 'main',
  };
  const GH_API = 'https://api.github.com';
  const TOKEN_KEY = 'douhuo_pt_gh_token';
  const LAST_TRIGGER_KEY = 'douhuo_pt_last_trigger';
  // 冷却：防止被连续点击刷爆斗货接口。生产 10 分钟；测试阶段按需求先关闭。
  const COOLDOWN_MS = 10 * 60 * 1000;
  const COOLDOWN_ENABLED = false;

  const els = {
    updatedAt: document.getElementById('updated-at'),
    goodsCount: document.getElementById('goods-count'),
    listSummary: document.getElementById('list-summary'),
    goodsList: document.getElementById('goods-list'),
    board: document.querySelector('.board'),
    loading: document.getElementById('loading'),
    empty: document.getElementById('empty'),
    errorBox: document.getElementById('error-box'),
    errorMsg: document.getElementById('error-msg'),
    banner: document.getElementById('banner'),
    alertBanner: document.getElementById('alert-banner'),
    alertCount: document.getElementById('alert-count'),
    searchInput: document.getElementById('search-input'),
    channelSelect: document.getElementById('channel-select'),
    btnReload: document.getElementById('btn-reload'),
    btnRetry: document.getElementById('btn-retry'),
    btnExport: document.getElementById('btn-export'),
    btnAlerts: document.getElementById('btn-alerts'),
    statTotal: document.getElementById('stat-total'),
    statUp: document.getElementById('stat-up'),
    statDown: document.getElementById('stat-down'),
    statMaxUp: document.getElementById('stat-max-up'),
    toast: document.getElementById('toast'),
    drawer: document.getElementById('drawer'),
    drawerBackdrop: document.getElementById('drawer-backdrop'),
    drawerTitle: document.getElementById('drawer-title'),
    drawerSpu: document.getElementById('drawer-spu'),
    drawerMeta: document.getElementById('drawer-meta'),
    drawerBody: document.getElementById('drawer-body'),
    btnCloseDrawer: document.getElementById('btn-close-drawer'),
    tokenModal: document.getElementById('token-modal'),
    tokenBackdrop: document.getElementById('token-backdrop'),
    tokenInput: document.getElementById('token-input'),
    btnSaveToken: document.getElementById('btn-save-token'),
    btnClearToken: document.getElementById('btn-clear-token'),
    btnCloseToken: document.getElementById('btn-close-token'),
  };

  const state = {
    products: null,
    history: null,
    filter: 'all',
    query: '',
    channel: '',
    charts: [],
    toastTimer: null,
    lastFocus: null,
    triggering: false,
    bannerTimer: null,
  };

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function getToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || '';
    } catch (_) {
      return '';
    }
  }

  function saveToken(v) {
    try {
      if (v) localStorage.setItem(TOKEN_KEY, v);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (_) {
      /* 隐私模式等无法写入时忽略 */
    }
  }

  function getLastTrigger() {
    try {
      const n = Number(localStorage.getItem(LAST_TRIGGER_KEY) || 0);
      return Number.isFinite(n) ? n : 0;
    } catch (_) {
      return 0;
    }
  }

  function markTriggered() {
    try {
      localStorage.setItem(LAST_TRIGGER_KEY, String(Date.now()));
    } catch (_) {
      /* ignore */
    }
  }

  function cooldownLeftMs() {
    if (!COOLDOWN_ENABLED) return 0;
    const left = COOLDOWN_MS - (Date.now() - getLastTrigger());
    return left > 0 ? left : 0;
  }

  function fmtCooldown(ms) {
    const total = Math.ceil(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;
  }

  function setRefreshBusy(busy) {
    els.btnReload.disabled = busy;
    els.btnReload.textContent = busy ? '采价中…' : '刷新';
  }

  function openTokenModal() {
    const has = !!getToken();
    els.tokenInput.value = '';
    els.tokenInput.placeholder = has ? '已保存令牌，如需更换请粘贴新的' : 'github_pat_… 或 ghp_…';
    els.btnClearToken.classList.toggle('hidden', !has);
    els.tokenModal.classList.remove('hidden');
    els.tokenModal.setAttribute('aria-hidden', 'false');
    els.tokenBackdrop.classList.remove('hidden');
    els.tokenBackdrop.hidden = false;
    els.tokenInput.focus();
  }

  function closeTokenModal() {
    els.tokenModal.classList.add('hidden');
    els.tokenModal.setAttribute('aria-hidden', 'true');
    els.tokenBackdrop.classList.add('hidden');
    els.tokenBackdrop.hidden = true;
    els.tokenInput.value = '';
  }

  async function ghFetch(path, token, options = {}) {
    const res = await fetch(`${GH_API}${path}`, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.headers || {}),
      },
    });
    if (res.status === 204) return null;
    let body = null;
    try {
      body = await res.json();
    } catch (_) {
      /* ignore */
    }
    if (!res.ok) {
      const err = new Error((body && body.message) || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return body;
  }

  async function waitForRun(token, sinceMs) {
    const tries = 40;
    const gap = 5000;
    for (let i = 0; i < tries; i++) {
      await sleep(gap);
      let data;
      try {
        data = await ghFetch(
          `/repos/${REPO.owner}/${REPO.repo}/actions/workflows/${REPO.workflow}/runs?per_page=5`,
          token
        );
      } catch (_) {
        continue;
      }
      const runs = (data && data.workflow_runs) || [];
      const mine = runs.find(
        (r) =>
          r.event === 'workflow_dispatch' && new Date(r.created_at).getTime() >= sinceMs - 15000
      );
      if (!mine) continue;
      if (mine.status === 'completed') {
        if (mine.conclusion === 'success') return true;
        console.warn('[refresh] 采价任务失败', mine.html_url);
        return false;
      }
      showBanner(`GitHub 正在采价（${mine.status}）…通常 30~60 秒完成`);
    }
    return null;
  }

  async function triggerCollect() {
    if (state.triggering) return;

    const left = cooldownLeftMs();
    if (left > 0) {
      showToast(`冷却中（还剩 ${fmtCooldown(left)}），已重新加载当前数据`);
      await loadAll();
      return;
    }

    const token = getToken();
    if (!token) {
      openTokenModal();
      return;
    }

    state.triggering = true;
    setRefreshBusy(true);
    const since = Date.now();
    showBanner('正在通知 GitHub 开始采价…');
    try {
      await ghFetch(
        `/repos/${REPO.owner}/${REPO.repo}/actions/workflows/${REPO.workflow}/dispatches`,
        token,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ref: REPO.ref }),
        }
      );
      markTriggered();
      showBanner('已通知 GitHub 采价，通常 30~60 秒完成，完成后会自动刷新…');
      showToast('已触发采价');
      const result = await waitForRun(token, since);
      if (result === true) {
        await loadAll();
        showToast('采价完成，数据已更新');
      } else if (result === false) {
        showBanner('采价任务执行失败，请到 GitHub Actions 查看日志。');
        showToast('采价失败');
      } else {
        showBanner('采价仍在进行中，稍后点「刷新」查看结果。');
      }
    } catch (err) {
      console.error('[refresh]', err.message);
      if (err.status === 401) {
        saveToken('');
        showBanner('GitHub 令牌无效或已过期，请点「刷新」重新填写。');
        showToast('令牌无效');
      } else if (err.status === 403) {
        showBanner('令牌权限不足：需要该仓库的 Actions 读写权限（经典 token 需勾选 workflow）。');
        showToast('权限不足');
      } else if (err.status === 404) {
        showBanner('找不到仓库或工作流，或令牌没有授权这个仓库。');
        showToast('触发失败');
      } else {
        showBanner(`触发失败：${err.message}`);
        showToast('触发失败');
      }
    } finally {
      state.triggering = false;
      setRefreshBusy(false);
      clearTimeout(state.bannerTimer);
      state.bannerTimer = setTimeout(() => showBanner(''), 15000);
    }
  }

  function channelName(code) {
    const n = Number(code);
    if (CHANNELS[n]) return CHANNELS[n];
    if (!Number.isFinite(n) || !code) return '未知渠道';
    return `渠道${n}`;
  }

  function fmtPrice(v) {
    if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
    const n = Number(v);
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
  }

  function fmtDelta(change, pct) {
    if (change === null || change === undefined || !Number.isFinite(Number(change))) {
      return { text: '—', cls: 'flat' };
    }
    const c = Number(change);
    const sign = c > 0 ? '+' : '';
    const pctText =
      pct === null || pct === undefined || !Number.isFinite(Number(pct))
        ? ''
        : ` (${sign}${Number(pct).toFixed(1)}%)`;
    if (Math.abs(c) < 0.005) return { text: '持平', cls: 'flat' };
    if (c > 0) return { text: `↑ ${sign}${c.toFixed(2)}${pctText}`, cls: 'up' };
    return { text: `↓ ${c.toFixed(2)}${pctText}`, cls: 'down' };
  }

  function fmtTime(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      const p = (x) => String(x).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    } catch {
      return iso;
    }
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeCssUrl(url) {
    let s = String(url || '');
    if (!s) return '';
    if (s.startsWith('http://')) s = 'https://' + s.slice(7);
    if (!/^https:\/\//i.test(s)) return '';
    return s.replace(/\\/g, '%5C').replace(/'/g, '%27').replace(/"/g, '%22');
  }

  function showBanner(msg) {
    if (!msg) {
      els.banner.classList.add('hidden');
      els.banner.textContent = '';
      return;
    }
    els.banner.textContent = msg;
    els.banner.classList.remove('hidden');
  }

  function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.remove('hidden');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 2600);
  }

  function setView(view) {
    els.loading.classList.toggle('hidden', view !== 'loading');
    els.empty.classList.toggle('hidden', view !== 'empty');
    els.errorBox.classList.toggle('hidden', view !== 'error');
    if (els.board) els.board.classList.toggle('is-state', view !== 'list');
    if (view !== 'list') {
      els.goodsList.innerHTML = '';
    }
  }

  async function fetchJson(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
    return res.json();
  }

  function allGoods() {
    return (state.products && state.products.goods) || [];
  }

  function updateStats() {
    const goods = allGoods();
    const ups = goods.filter((g) => g.price_change > 0);
    const downs = goods.filter((g) => g.price_change < 0);
    const maxUp = goods.reduce((acc, g) => {
      if (!(g.price_change > 0)) return acc;
      if (acc === null || g.price_change > acc) return g.price_change;
      return acc;
    }, null);

    els.statTotal.textContent = String(goods.length);
    els.statUp.textContent = String(ups.length);
    els.statDown.textContent = String(downs.length);
    els.statMaxUp.textContent = maxUp === null ? '—' : `+${maxUp.toFixed(2)}`;

    els.alertCount.textContent = String(ups.length);
    els.alertCount.classList.toggle('hidden', ups.length === 0);

    if (ups.length > 0) {
      const top = ups
        .slice()
        .sort((a, b) => (b.price_change || 0) - (a.price_change || 0))
        .slice(0, 3)
        .map((g) => {
          const name = String(g.goods_name || '').slice(0, 18);
          return `${name} +${Number(g.price_change).toFixed(2)}`;
        })
        .join('；');
      els.alertBanner.textContent = `涨价提醒：${ups.length} 个商品较上次上涨。${top}`;
      els.alertBanner.classList.remove('hidden');
    } else {
      els.alertBanner.classList.add('hidden');
      els.alertBanner.textContent = '';
    }
  }

  function fillChannelOptions() {
    const counts = new Map();
    for (const g of allGoods()) {
      const key = String(g.supply_type ?? '');
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const keys = [...counts.keys()].sort((a, b) => Number(a) - Number(b));
    const current = state.channel;
    els.channelSelect.innerHTML = '<option value="">全部渠道</option>';
    for (const key of keys) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = `${channelName(key)} (${counts.get(key)})`;
      els.channelSelect.appendChild(opt);
    }
    els.channelSelect.value = current;
  }

  function filteredGoods() {
    const goods = allGoods();
    const q = state.query.trim().toLowerCase();
    return goods.filter((g) => {
      if (state.filter === 'up' && !(g.price_change > 0)) return false;
      if (state.filter === 'down' && !(g.price_change < 0)) return false;
      if (state.channel !== '' && String(g.supply_type ?? '') !== state.channel) return false;
      if (!q) return true;
      const hay = [g.goods_name, g.spu_sn, String(g.goods_id), channelName(g.supply_type)]
        .concat((g.skus || []).map((s) => `${s.sku_name} ${s.attr_text} ${s.sku_id}`))
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }

  function renderList() {
    const rows = filteredGoods();
    els.listSummary.textContent = `显示 ${rows.length} / ${allGoods().length} 个商品`;
    if (!rows.length) {
      setView('empty');
      return;
    }
    setView('list');
    const frag = document.createDocumentFragment();
    for (const g of rows) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'goods-row';
      btn.dataset.goodsId = String(g.goods_id);
      if (g.price_change > 0) btn.classList.add('is-up');
      const delta = fmtDelta(g.price_change, g.price_change_pct);
      const imgSrc = safeCssUrl(g.main_img);
      const upDot = g.price_change > 0 ? '<span class="up-dot" title="有涨价"></span>' : '';
      const dateText = fmtTime((state.products && state.products.updated_at) || '').slice(0, 10);
      const thumbHtml = imgSrc
        ? `<div class="thumb"><img src="${imgSrc}" alt="" loading="lazy" decoding="async" onerror="this.parentNode.classList.add('is-fallback');this.remove();" /></div>`
        : `<div class="thumb is-fallback" aria-hidden="true"></div>`;
      btn.innerHTML = `
        <div class="cell-product">
          ${thumbHtml}
          <div class="product-text">
            <p class="product-name">${upDot}${escapeHtml(g.goods_name)}</p>
            <p class="product-meta">
              <span class="chip">${escapeHtml(channelName(g.supply_type))}</span>
              <span class="spu">${escapeHtml(g.spu_sn || '')}</span>
            </p>
          </div>
        </div>
        <div class="cell-price">¥${fmtPrice(g.min_price)}</div>
        <div class="cell-delta ${delta.cls}">${delta.text}</div>
        <span class="cell-sku">${g.sku_count ?? (g.skus || []).length} SKU</span>
        <div class="cell-date">${escapeHtml(dateText)}</div>
      `;
      btn.addEventListener('click', () => openDrawer(g));
      frag.appendChild(btn);
    }
    els.goodsList.innerHTML = '';
    els.goodsList.appendChild(frag);
  }

  function csvEscape(val) {
    let s = val === null || val === undefined ? '' : String(val);
    // 降低 Excel 公式注入风险
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function historyMinMax(goodsId) {
    const g = state.history && state.history[String(goodsId)];
    if (!g || !g.skus) return { min: null, max: null };
    const prices = [];
    for (const sku of Object.values(g.skus)) {
      for (const pt of sku.points || []) {
        const n = Number(pt.price);
        if (Number.isFinite(n)) prices.push(n);
      }
    }
    if (!prices.length) return { min: null, max: null };
    return { min: Math.min(...prices), max: Math.max(...prices) };
  }

  function exportCsv() {
    const rows = filteredGoods();
    if (!rows.length) {
      showToast('当前筛选没有可导出的商品');
      return;
    }
    const date = (state.products && state.products.date) || '';
    const header = [
      '采集日期',
      'goods_id',
      'SPU',
      '商品名称',
      '渠道',
      '现价(当前最低代发价)',
      '历史最低价',
      '历史最高价',
      '上次代发价',
      '涨跌额',
      '涨跌%',
      'SKU数',
      '更新时间',
    ];
    const lines = [header.join(',')];
    for (const g of rows) {
      const mm = historyMinMax(g.goods_id);
      lines.push(
        [
          date,
          g.goods_id,
          g.spu_sn,
          g.goods_name,
          channelName(g.supply_type),
          g.min_price,
          mm.min,
          mm.max,
          g.prev_price,
          g.price_change,
          g.price_change_pct,
          g.sku_count,
          state.products?.updated_at || '',
        ]
          .map(csvEscape)
          .join(',')
      );
    }
    // BOM 便于 Excel 打开中文
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `代发价_${date || 'export'}_${rows.length}条.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast(`已导出 ${rows.length} 条`);
  }

  function destroyCharts() {
    for (const c of state.charts) {
      try {
        c.destroy();
      } catch (_) {
        /* ignore */
      }
    }
    state.charts = [];
  }

  function pointsFor(goodsId, skuId) {
    const g = state.history && state.history[String(goodsId)];
    const s = g && g.skus && g.skus[String(skuId)];
    return (s && s.points) || [];
  }

  function statBlock(label, value) {
    return `<div class="sku-stat"><span class="n">${escapeHtml(value)}</span><span class="l">${escapeHtml(label)}</span></div>`;
  }

  function openDrawer(goods) {
    destroyCharts();
    els.drawerTitle.textContent = goods.goods_name || '商品详情';
    els.drawerSpu.textContent = `${channelName(goods.supply_type)} · ${goods.spu_sn || ''}`;
    const delta = fmtDelta(goods.price_change, goods.price_change_pct);
    const deltaColor =
      delta.cls === 'up' ? 'var(--up)' : delta.cls === 'down' ? 'var(--down)' : 'var(--flat)';
    els.drawerMeta.innerHTML = `
      <div class="kv"><span class="kv-label">当前最低代发价</span><span class="kv-value">¥${fmtPrice(goods.min_price)}</span></div>
      <div class="kv"><span class="kv-label">较上次</span><span class="kv-value" style="color:${deltaColor}">${delta.text}</span></div>
      <div class="kv"><span class="kv-label">规格数</span><span class="kv-value">${goods.sku_count ?? (goods.skus || []).length}</span></div>
      <div class="kv"><span class="kv-label">渠道</span><span class="kv-value">${escapeHtml(channelName(goods.supply_type))}</span></div>
    `;

    const skus = goods.skus || [];
    els.drawerBody.innerHTML = '';
    if (!skus.length) {
      els.drawerBody.innerHTML = '<p class="state-desc">该商品暂无可用规格价格。</p>';
    }

    let chartIdx = 0;
    for (const sku of skus) {
      const card = document.createElement('section');
      card.className = 'sku-card';
      const pts = pointsFor(goods.goods_id, sku.sku_id);
      const prices = pts.map((p) => Number(p.price)).filter((n) => Number.isFinite(n));
      const first = prices.length ? prices[0] : null;
      const last = prices.length ? prices[prices.length - 1] : sku.price;
      const min = prices.length ? Math.min(...prices) : sku.price;
      const max = prices.length ? Math.max(...prices) : sku.price;
      const histDelta =
        first !== null && last !== null && Number.isFinite(first) && Number.isFinite(last)
          ? last - first
          : null;
      const deltaInfo = fmtDelta(
        histDelta,
        first ? Math.round(((last - first) / first) * 10000) / 100 : null
      );

      card.innerHTML = `
        <h3>${escapeHtml(sku.sku_name || '规格 ' + sku.sku_id)}</h3>
        <p class="sku-attr">${escapeHtml(sku.attr_text || '')} · ID ${escapeHtml(sku.sku_id)}</p>
        <div class="sku-stats">
          ${statBlock('当前价', '¥' + fmtPrice(last ?? sku.price))}
          ${statBlock('区间涨跌', deltaInfo.text)}
          ${statBlock('最低', '¥' + fmtPrice(min))}
          ${statBlock('最高', '¥' + fmtPrice(max))}
        </div>
      `;

      if (prices.length >= 2 && typeof Chart !== 'undefined') {
        const wrap = document.createElement('div');
        wrap.className = 'chart-wrap';
        const canvas = document.createElement('canvas');
        canvas.id = `chart-${chartIdx++}`;
        wrap.appendChild(canvas);
        card.appendChild(wrap);
        els.drawerBody.appendChild(card);
        requestAnimationFrame(() => {
          const ctx = canvas.getContext('2d');
          const chart = new Chart(ctx, {
            type: 'line',
            data: {
              labels: pts.map((p) => p.date),
              datasets: [
                {
                  label: '代发价',
                  data: pts.map((p) => p.price),
                  borderColor: '#2457d6',
                  backgroundColor: 'rgba(36, 87, 214, 0.12)',
                  fill: true,
                  tension: 0.25,
                  pointRadius: 3,
                  pointHoverRadius: 5,
                },
              ],
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { display: false },
                tooltip: {
                  callbacks: {
                    label: (c) => `¥${fmtPrice(c.parsed.y)}`,
                  },
                },
              },
              scales: {
                y: {
                  ticks: {
                    callback: (v) => '¥' + v,
                    color: '#5b6775',
                  },
                  grid: { color: 'rgba(226, 231, 238, 0.9)' },
                },
                x: {
                  ticks: { color: '#5b6775', maxRotation: 0, autoSkipPadding: 12 },
                  grid: { display: false },
                },
              },
            },
          });
          state.charts.push(chart);
        });
      } else {
        const empty = document.createElement('div');
        empty.className = 'chart-empty';
        empty.textContent =
          prices.length <= 1
            ? '历史点不足 2 个，采集多日后将显示趋势'
            : '图表库未加载（需可访问 CDN）';
        card.appendChild(empty);
        els.drawerBody.appendChild(card);
      }
    }

    els.drawer.classList.remove('hidden');
    els.drawer.setAttribute('aria-hidden', 'false');
    els.drawerBackdrop.classList.remove('hidden');
    els.drawerBackdrop.hidden = false;
    document.body.style.overflow = 'hidden';
    state.lastFocus = document.activeElement;
    els.btnCloseDrawer.focus();
  }

  function closeDrawer() {
    destroyCharts();
    els.drawer.classList.add('hidden');
    els.drawer.setAttribute('aria-hidden', 'true');
    els.drawerBackdrop.classList.add('hidden');
    els.drawerBackdrop.hidden = true;
    document.body.style.overflow = '';
    if (state.lastFocus && typeof state.lastFocus.focus === 'function') {
      try { state.lastFocus.focus(); } catch (_) { /* ignore */ }
    }
    state.lastFocus = null;
  }

  async function loadAll() {
    setView('loading');
    showBanner('');
    els.listSummary.textContent = '加载中…';
    try {
      const [products, history] = await Promise.all([
        fetchJson(`${DATA_BASE}/products.json`),
        fetchJson(`${DATA_BASE}/history.json`).catch(() => ({})),
      ]);
      state.products = products;
      state.history = history || {};
      els.updatedAt.textContent = fmtTime(products.updated_at);
      els.goodsCount.textContent = String(products.goods_count ?? allGoods().length);
      if (products.error_count > 0) {
        showBanner(
          `上次采集有 ${products.error_count} 个商品失败，列表可能不完整。详见 data/products.json 的 errors 字段。`
        );
      }
      updateStats();
      fillChannelOptions();
      renderList();
    } catch (err) {
      console.error(err);
      els.errorMsg.textContent =
        '无法读取 data/products.json。请先运行 `npm run collect` 生成数据，并用本地静态服务打开（不要直接双击 HTML）。';
      setView('error');
      els.updatedAt.textContent = '—';
      els.goodsCount.textContent = '—';
      els.listSummary.textContent = '加载失败';
      els.alertBanner.classList.add('hidden');
    }
  }

  // events
  els.searchInput.addEventListener('input', () => {
    state.query = els.searchInput.value;
    if (state.products) renderList();
  });

  els.channelSelect.addEventListener('change', () => {
    state.channel = els.channelSelect.value;
    if (state.products) renderList();
  });

  document.querySelectorAll('.seg').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.seg').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      state.filter = chip.dataset.filter || 'all';
      if (state.products) renderList();
    });
  });

  els.btnReload.addEventListener('click', triggerCollect);
  els.btnRetry.addEventListener('click', loadAll);

  els.btnSaveToken.addEventListener('click', async () => {
    const v = els.tokenInput.value.trim();
    if (!v) {
      showToast('请先粘贴 GitHub 令牌');
      els.tokenInput.focus();
      return;
    }
    saveToken(v);
    closeTokenModal();
    await triggerCollect();
  });
  els.btnClearToken.addEventListener('click', () => {
    saveToken('');
    els.tokenInput.value = '';
    els.btnClearToken.classList.add('hidden');
    showToast('已清除本机保存的令牌');
  });
  els.btnCloseToken.addEventListener('click', closeTokenModal);
  els.tokenBackdrop.addEventListener('click', closeTokenModal);
  els.tokenInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') els.btnSaveToken.click();
  });
  els.btnExport.addEventListener('click', exportCsv);
  els.btnAlerts.addEventListener('click', () => {
    document.querySelectorAll('.seg').forEach((c) => c.classList.remove('active'));
    const upChip = document.querySelector('.seg[data-filter="up"]');
    if (upChip) upChip.classList.add('active');
    state.filter = 'up';
    if (state.products) renderList();
    const n = allGoods().filter((g) => g.price_change > 0).length;
    showToast(n ? `已筛出 ${n} 个涨价商品` : '当前没有涨价商品');
  });
  els.btnCloseDrawer.addEventListener('click', closeDrawer);
  els.drawerBackdrop.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeTokenModal();
      closeDrawer();
    }
  });

  loadAll();
})();
