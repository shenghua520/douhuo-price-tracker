/* 已选品代发价监控 — 纯静态前端 */
(function () {
  'use strict';

  const DATA_BASE = 'data';
  const els = {
    updatedAt: document.getElementById('updated-at'),
    goodsCount: document.getElementById('goods-count'),
    listSummary: document.getElementById('list-summary'),
    goodsList: document.getElementById('goods-list'),
    loading: document.getElementById('loading'),
    empty: document.getElementById('empty'),
    errorBox: document.getElementById('error-box'),
    errorMsg: document.getElementById('error-msg'),
    banner: document.getElementById('banner'),
    searchInput: document.getElementById('search-input'),
    btnReload: document.getElementById('btn-reload'),
    btnRetry: document.getElementById('btn-retry'),
    drawer: document.getElementById('drawer'),
    drawerBackdrop: document.getElementById('drawer-backdrop'),
    drawerTitle: document.getElementById('drawer-title'),
    drawerSpu: document.getElementById('drawer-spu'),
    drawerMeta: document.getElementById('drawer-meta'),
    drawerBody: document.getElementById('drawer-body'),
    btnCloseDrawer: document.getElementById('btn-close-drawer'),
  };

  const state = {
    products: null,
    history: null,
    filter: 'all',
    query: '',
    charts: [],
  };

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
    // 只允许 http(s) 图片，避免在 CSS url() 里注入
    const s = String(url || '');
    if (!/^https?:\/\//i.test(s)) return '';
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

  function setView(view) {
    els.loading.classList.toggle('hidden', view !== 'loading');
    els.empty.classList.toggle('hidden', view !== 'empty');
    els.errorBox.classList.toggle('hidden', view !== 'error');
    if (view !== 'list') {
      els.goodsList.innerHTML = '';
    }
  }

  async function fetchJson(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
    return res.json();
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
      els.goodsCount.textContent = String(products.goods_count ?? (products.goods || []).length);
      if (products.error_count > 0) {
        showBanner(
          `上次采集有 ${products.error_count} 个商品失败，列表可能不完整。详见 data/products.json 的 errors 字段。`
        );
      }
      renderList();
    } catch (err) {
      console.error(err);
      els.errorMsg.textContent =
        '无法读取 data/products.json。请先运行 `npm run collect` 生成数据，并用本地静态服务打开（不要直接双击 HTML）。';
      setView('error');
      els.updatedAt.textContent = '—';
      els.goodsCount.textContent = '—';
      els.listSummary.textContent = '加载失败';
    }
  }

  function filteredGoods() {
    const goods = (state.products && state.products.goods) || [];
    const q = state.query.trim().toLowerCase();
    return goods.filter((g) => {
      if (state.filter === 'up' && !(g.price_change > 0)) return false;
      if (state.filter === 'down' && !(g.price_change < 0)) return false;
      if (!q) return true;
      const hay = [g.goods_name, g.spu_sn, String(g.goods_id)]
        .concat((g.skus || []).map((s) => `${s.sku_name} ${s.attr_text} ${s.sku_id}`))
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }

  function renderList() {
    const rows = filteredGoods();
    els.listSummary.textContent = `显示 ${rows.length} / ${((state.products && state.products.goods) || []).length} 个商品`;
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
      btn.setAttribute('role', 'listitem');
      btn.dataset.goodsId = String(g.goods_id);
      const delta = fmtDelta(g.price_change, g.price_change_pct);
      const imgSrc = safeCssUrl(g.main_img);
      const img = imgSrc ? `style="background-image:url('${imgSrc}')"` : '';
      btn.innerHTML = `
        <div class="thumb" ${img} aria-hidden="true"></div>
        <div class="goods-main">
          <p class="goods-name">${escapeHtml(g.goods_name)}</p>
          <p class="goods-code">${escapeHtml(g.spu_sn || '')}</p>
        </div>
        <div class="price-block">
          <div class="price-main">¥${fmtPrice(g.min_price)}<span class="price-unit"></span></div>
        </div>
        <div class="delta-cell"><span class="delta ${delta.cls}">${delta.text}</span></div>
        <div><span class="badge">${g.sku_count ?? (g.skus || []).length} SKU</span></div>
        <div class="row-time">${escapeHtml(fmtTime((state.products && state.products.updated_at) || '').slice(0, 10))}</div>
      `;
      btn.addEventListener('click', () => openDrawer(g));
      frag.appendChild(btn);
    }
    els.goodsList.innerHTML = '';
    els.goodsList.appendChild(frag);
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
    els.drawerSpu.textContent = goods.spu_sn || '';
    const delta = fmtDelta(goods.price_change, goods.price_change_pct);
    els.drawerMeta.innerHTML = `
      <div class="kv"><span class="kv-label">当前最低代发价</span><span class="kv-value">¥${fmtPrice(goods.min_price)}</span></div>
      <div class="kv"><span class="kv-label">较上次</span><span class="kv-value" style="color:var(--${delta.cls === 'up' ? 'up' : delta.cls === 'down' ? 'down' : 'flat'})">${delta.text}</span></div>
      <div class="kv"><span class="kv-label">规格数</span><span class="kv-value">${goods.sku_count ?? (goods.skus || []).length}</span></div>
      <div class="kv"><span class="kv-label">渠道</span><span class="kv-value">${escapeHtml(goods.supply_type ?? '—')}</span></div>
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
  }

  function closeDrawer() {
    destroyCharts();
    els.drawer.classList.add('hidden');
    els.drawer.setAttribute('aria-hidden', 'true');
    els.drawerBackdrop.classList.add('hidden');
    els.drawerBackdrop.hidden = true;
    document.body.style.overflow = '';
  }

  // events
  els.searchInput.addEventListener('input', () => {
    state.query = els.searchInput.value;
    if (state.products) renderList();
  });

  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      state.filter = chip.dataset.filter || 'all';
      if (state.products) renderList();
    });
  });

  els.btnReload.addEventListener('click', loadAll);
  els.btnRetry.addEventListener('click', loadAll);
  els.btnCloseDrawer.addEventListener('click', closeDrawer);
  els.drawerBackdrop.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDrawer();
  });

  loadAll();
})();
