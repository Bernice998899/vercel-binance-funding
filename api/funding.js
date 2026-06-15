const ccxt = require('ccxt');
const crypto = require('crypto');

const FUNDING_WINDOW_MS = 120.01 * 60 * 60 * 1000; // 5 天
const FUNDING_PAGE_LIMIT = 100;
const FUNDING_MAX_PAGES = 8; // 5天/8h = 15 条，多翻几页留 buffer
const NEGATIVE_FUNDING_SIGN = new Set(['phemex', 'bybit']);
const COINS = ['USDT', 'USDC'];

const toSGTime = (ts) =>
  new Date(ts).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' });

const cleanSymbol = (s) => {
  if (!s) return s;
  let out = s;
  if (out.includes('/')) out = out.split('/')[0];
  if (out.includes(':')) out = out.split(':')[0];
  return out;
};

const convertMexcOrderSide = (code) => {
  if (code === '1' || code === 1 || code === '3' || code === 3) return 'buy';
  if (code === '2' || code === 2 || code === '4' || code === 4) return 'sell';
  return code;
};

const num = (v) => parseFloat(v || 0) || 0;

// 把 CCXT/网络错误归类成人能看懂的简短描述
function classifyError(err, exchangeName) {
  const name = err?.constructor?.name || err?.name || '';
  const raw = String(err?.message || err || '').slice(0, 200);
  const ex = exchangeName ? exchangeName.toUpperCase() : 'Exchange';

  if (/AuthenticationError|PermissionDenied/i.test(name) ||
      /api[\s_-]?key|signature|invalid.*key|unauthorized|permission|passphrase|apikey/i.test(raw)) {
    return { type: 'auth', message: `${ex} 认证失败 (API key 过期/无效/权限不足)` };
  }
  if (/RateLimitExceeded|DDoSProtection/i.test(name) ||
      /rate limit|too many|too much|429|frequenc/i.test(raw)) {
    return { type: 'ratelimit', message: `${ex} 请求过于频繁 (rate limit / too many requests)` };
  }
  if (/RequestTimeout|ETIMEDOUT|ENOTFOUND|ECONNRESET|NetworkError|ExchangeNotAvailable/i.test(name) ||
      /timeout|timed out|network|ENOTFOUND|ECONNRESET|getaddrinfo|socket hang/i.test(raw)) {
    return { type: 'network', message: `${ex} 网络超时/无法连接` };
  }
  if (/InvalidNonce/i.test(name) || /nonce|timestamp|recv.?window|time.*sync/i.test(raw)) {
    return { type: 'time', message: `${ex} 时间戳/nonce 错误 (服务器时间不同步)` };
  }
  if (/AccountSuspended|AccountNotEnabled/i.test(name) || /suspend|frozen|disabled|not enabled/i.test(raw)) {
    return { type: 'account', message: `${ex} 账户被冻结/未启用` };
  }
  if (/ExchangeError/i.test(name)) {
    return { type: 'exchange', message: `${ex} 交易所返回错误: ${raw}` };
  }
  return { type: 'unknown', message: `${ex}: ${raw}` };
}

const emptyWallet = () => ({
  futures: { USDT: 0, USDC: 0 },
  spot: { USDT: 0, USDC: 0 },
  funding: { USDT: 0, USDC: 0 },
  total: 0,
});

const sumWallet = (w) => {
  let t = 0;
  for (const bucket of ['futures', 'spot', 'funding']) {
    for (const coin of COINS) t += w[bucket][coin] || 0;
  }
  return t;
};

// ---------- Bitget UTA (Unified Trading Account) 原生请求 ----------
const BITGET_BASE_URL = 'https://api.bitget.com';

function bitgetSign(timestamp, method, path, body, secret) {
  const prehash = timestamp + method.toUpperCase() + path + body;
  return crypto.createHmac('sha256', secret).update(prehash).digest('base64');
}

async function bitgetUtaRequest(method, path, params = {}) {
  const apiKey = process.env.BITGET_API_KEY;
  const secret = process.env.BITGET_API_SECRET;
  const passphrase = process.env.BITGET_API_PASSPHRASE;

  const timestamp = Date.now().toString();
  let requestPath = path;
  let body = '';

  if (method === 'GET') {
    const qs = new URLSearchParams(params).toString();
    if (qs) requestPath = `${path}?${qs}`;
  } else {
    body = JSON.stringify(params);
  }

  const sign = bitgetSign(timestamp, method, requestPath, body, secret);

  const headers = {
    'ACCESS-KEY': apiKey,
    'ACCESS-SIGN': sign,
    'ACCESS-TIMESTAMP': timestamp,
    'ACCESS-PASSPHRASE': passphrase,
    'Content-Type': 'application/json',
    'locale': 'en-US',
  };

  const url = `${BITGET_BASE_URL}${requestPath}`;
  const res = await fetch(url, {
    method,
    headers,
    body: method === 'GET' ? undefined : body,
  });

  const json = await res.json();
  if (json.code && json.code !== '00000') {
    throw new Error(`Bitget UTA ${path}: ${json.code} ${json.msg}`);
  }
  return json.data;
}

function buildExchanges() {
  return {
    binance: new ccxt.binance({
      apiKey: process.env.BINANCE_API_KEY,
      secret: process.env.BINANCE_API_SECRET,
      enableRateLimit: true,
      options: { defaultType: 'future', warnOnFetchOpenOrdersWithoutSymbol: false },
    }),
    phemex: new ccxt.phemex({
      apiKey: process.env.PHEMEX_API_KEY,
      secret: process.env.PHEMEX_API_SECRET,
      enableRateLimit: true,
      options: { defaultType: 'swap' },
    }),
    bybit: new ccxt.bybit({
      apiKey: process.env.BYBIT_API_KEY,
      secret: process.env.BYBIT_API_SECRET,
      enableRateLimit: true,
      options: { defaultType: 'swap' },
    }),
    mexc: new ccxt.mexc({
      apiKey: process.env.MEXC_API_KEY,
      secret: process.env.MEXC_API_SECRET,
      enableRateLimit: true,
      options: { defaultType: 'swap' },
    }),
    aster: new ccxt.aster({
      privateKey: process.env.ASTER_PRIVATE_KEY || process.env.ASTER_API_SECRET,
      enableRateLimit: true,
      options: {
        defaultType: 'swap',
        warnOnFetchOpenOrdersWithoutSymbol: false,
      },
    }),
    bitget: new ccxt.bitget({
      // ⚠️ 账户是 Unified Trading Account (UTA)
      // 余额/持仓走原生 /api/v3 (bitgetUtaRequest)，此实例仅供 ticker 公共数据使用
      apiKey: process.env.BITGET_API_KEY,
      secret: process.env.BITGET_API_SECRET,
      password: process.env.BITGET_API_PASSPHRASE,
      enableRateLimit: true,
      options: { defaultType: 'swap' },
    }),
  };
}

// ---------- 余额 ----------
async function fetchBinanceEquity(ex) {
  const w = emptyWallet();
  const [umBal, spotBal, fundingBal] = await Promise.all([
    ex.fetchBalance({ type: 'future' }).catch(() => ({})),
    ex.fetchBalance({ type: 'spot' }).catch(() => ({})),
    ex.fetchBalance({ type: 'funding' }).catch(() => ({})),
  ]);

  const umAssets = umBal?.info?.assets || [];
  for (const a of umAssets) {
    if (a.asset === 'USDT') w.futures.USDT = num(a.marginBalance);
    if (a.asset === 'USDC') w.futures.USDC = num(a.marginBalance);
  }
  if (!w.futures.USDT && !w.futures.USDC) {
    w.futures.USDT = num(umBal?.info?.totalMarginBalance);
  }

  w.spot.USDT = num(spotBal?.total?.USDT);
  w.spot.USDC = num(spotBal?.total?.USDC);
  w.funding.USDT = num(fundingBal?.total?.USDT || fundingBal?.free?.USDT);
  w.funding.USDC = num(fundingBal?.total?.USDC || fundingBal?.free?.USDC);

  w.total = sumWallet(w);
  return w;
}

async function fetchPhemexEquity(ex) {
  const w = emptyWallet();
  const [usdtSwap, usdcSwap, spot] = await Promise.all([
    ex.fetchBalance({ type: 'swap', code: 'USDT' }).catch(() => ({})),
    ex.fetchBalance({ type: 'swap', code: 'USDC' }).catch(() => ({})),
    ex.fetchBalance({ type: 'spot' }).catch(() => ({})),
  ]);

  const parsePhemex = (bal, fallbackCoin) => {
    let v = num(bal?.info?.data?.account?.accountBalanceRv);
    if (!v) {
      const ev = bal?.info?.data?.account?.accountBalanceEv;
      if (ev) v = num(ev) / 1e8;
    }
    if (!v) v = num(bal?.total?.[fallbackCoin]);
    return v;
  };

  w.futures.USDT = parsePhemex(usdtSwap, 'USDT');
  w.futures.USDC = parsePhemex(usdcSwap, 'USDC');
  w.spot.USDT = num(spot?.total?.USDT);
  w.spot.USDC = num(spot?.total?.USDC);

  w.total = sumWallet(w);
  return w;
}

async function fetchBybitEquity(ex) {
  const w = emptyWallet();
  const [unified, fund] = await Promise.all([
    ex.fetchBalance({ type: 'unified' }).catch(() =>
      ex.fetchBalance({ type: 'swap' }).catch(() => ({}))
    ),
    ex.fetchBalance({ type: 'funding' }).catch(() => ({})),
  ]);

  const coinList = unified?.info?.result?.list?.[0]?.coin || [];
  for (const c of coinList) {
    if (c.coin === 'USDT') w.futures.USDT = num(c.equity || c.walletBalance);
    if (c.coin === 'USDC') w.futures.USDC = num(c.equity || c.walletBalance);
  }
  if (!w.futures.USDT && !w.futures.USDC) {
    w.futures.USDT = num(unified?.info?.result?.list?.[0]?.totalEquity);
  }

  const fundList = fund?.info?.result?.balance || [];
  for (const b of fundList) {
    if (b.coin === 'USDT') w.funding.USDT = num(b.walletBalance);
    if (b.coin === 'USDC') w.funding.USDC = num(b.walletBalance);
  }

  w.total = sumWallet(w);
  return w;
}

async function fetchMexcEquity(ex) {
  const w = emptyWallet();
  const [swapBal, spotBal] = await Promise.all([
    ex.fetchBalance({ type: 'swap' }).catch(() => ({})),
    ex.fetchBalance({ type: 'spot' }).catch(() => ({})),
  ]);

  const dataArr = swapBal?.info?.data;
  if (Array.isArray(dataArr)) {
    for (const c of dataArr) {
      if (c.currency === 'USDT') w.futures.USDT = num(c.equity);
      if (c.currency === 'USDC') w.futures.USDC = num(c.equity);
    }
  } else if (dataArr && typeof dataArr === 'object') {
    w.futures.USDT = num(dataArr.equity || dataArr.availableBalance);
  }
  if (!w.futures.USDT && !w.futures.USDC) {
    w.futures.USDT = num(swapBal?.total?.USDT);
    w.futures.USDC = num(swapBal?.total?.USDC);
  }

  w.spot.USDT = num(spotBal?.total?.USDT);
  w.spot.USDC = num(spotBal?.total?.USDC);

  w.total = sumWallet(w);
  return w;
}

async function fetchAsterEquity(ex) {
  const w = emptyWallet();
  const [swapBal, spotBal] = await Promise.all([
    ex.fetchBalance({ type: 'swap' }).catch((e) => {
      console.error('❌ aster swap balance:', e.message);
      return {};
    }),
    ex.fetchBalance({ type: 'spot' }).catch(() => ({})),
  ]);

  console.log('🔍 aster swap total:', JSON.stringify(swapBal?.total || {}));

  const infoArr = Array.isArray(swapBal?.info) ? swapBal.info : null;
  if (infoArr) {
    for (const b of infoArr) {
      const val = num(b.balance || b.crossWalletBalance || b.availableBalance);
      if (b.asset === 'USDT') w.futures.USDT = val;
      if (b.asset === 'USDC') w.futures.USDC = val;
    }
  }
  if (!w.futures.USDT && !w.futures.USDC) {
    w.futures.USDT = num(swapBal?.total?.USDT);
    w.futures.USDC = num(swapBal?.total?.USDC);
  }

  w.spot.USDT = num(spotBal?.total?.USDT);
  w.spot.USDC = num(spotBal?.total?.USDC);

  w.total = sumWallet(w);
  return w;
}

// Bitget UTA：余额走 /api/v3/account/assets（单个 object，顶层 usdtEquity）
async function fetchBitgetEquity() {
  const w = emptyWallet();
  try {
    const data = await bitgetUtaRequest('GET', '/api/v3/account/assets');
    console.log('🔍 bitget UTA assets:', JSON.stringify(data));

    // 顶层 usdtEquity = 整个 UTA 账户折合 USDT 权益
    w.futures.USDT = num(data?.usdtEquity || data?.accountEquity);

    // assets[] 里若有 USDC 单独累加
    const assets = data?.assets;
    if (Array.isArray(assets)) {
      for (const a of assets) {
        if (a.coin === 'USDC') {
          w.futures.USDC = num(a.usdValue || a.equity);
        }
      }
    }
  } catch (e) {
    console.error('❌ bitget UTA equity:', e.message);
    throw e; // 让上层 classifyError 处理
  }

  w.total = sumWallet(w);
  return w;
}

const BALANCE_FETCHERS = {
  binance: fetchBinanceEquity,
  phemex: fetchPhemexEquity,
  bybit: fetchBybitEquity,
  mexc: fetchMexcEquity,
  aster: fetchAsterEquity,
  bitget: fetchBitgetEquity,
};

// ---------- Ticker ----------
async function buildTickerCache(exchange, symbols) {
  if (!symbols.length) return {};
  try {
    const tickers = await exchange.fetchTickers(symbols);
    return tickers || {};
  } catch {
    const entries = await Promise.all(
      symbols.map(async (s) => {
        try { return [s, await exchange.fetchTicker(s)]; }
        catch { return [s, null]; }
      })
    );
    return Object.fromEntries(entries.filter(([, t]) => t));
  }
}

function computePnL(pos, ticker, positionSize) {
  const currentPrice = ticker?.last || 0;
  const avgPrice = pos.entryPrice || pos.entry_price || 0;
  const amount = Math.abs(positionSize || pos.contracts || pos.positionAmt || 0);
  const side = pos.side || (pos.contracts > 0 ? 'long' : 'short');

  let pnl = (currentPrice - avgPrice) * amount;
  if (String(side).toLowerCase().includes('short')) {
    pnl = (avgPrice - currentPrice) * amount;
  }
  return { unrealizedPnl: pnl, positionValue: currentPrice * amount, currentPrice, side };
}

// ---------- Funding ----------
async function fetchFundingWindow(exchange, symbol, sinceMs, nowMs) {
  const seen = new Set();
  const all = [];
  let start = sinceMs;

  for (let i = 0; i < FUNDING_MAX_PAGES; i++) {
    let page;
    try { page = await exchange.fetchFundingHistory(symbol, start, FUNDING_PAGE_LIMIT); }
    catch { break; }
    if (!page?.length) break;

    for (const f of page) {
      if (f.timestamp >= sinceMs && f.timestamp <= nowMs) {
        const key = `${f.timestamp}-${f.amount}`;
        if (!seen.has(key)) { seen.add(key); all.push(f); }
      }
    }
    const last = page[page.length - 1]?.timestamp;
    if (!last || last <= start || page.length < FUNDING_PAGE_LIMIT) break;
    start = last + 1;
  }
  all.sort((a, b) => b.timestamp - a.timestamp);
  return all;
}

// ---------- 持仓 ----------
async function processExchangePositions(name, exchange, nowMs, sinceMs) {
  let positions;
  try {
    if (name === 'bitget') {
      // UTA：/api/v3/position/current-position，category=USDT-FUTURES
      const raw = await bitgetUtaRequest('GET', '/api/v3/position/current-position', { category: 'USDT-FUTURES' });
      console.log('🔍 bitget UTA positions:', JSON.stringify(raw));
      const list = Array.isArray(raw?.list) ? raw.list : (Array.isArray(raw) ? raw : []);

      // 调试：确认 CCXT markets 里对应的 symbol 格式（正常后可删）
      for (const p of list) {
        const matches = Object.keys(exchange.markets || {}).filter(k =>
          k.toUpperCase().includes(p.symbol.toUpperCase().replace('USDT', ''))
        );
        console.log(`🔍 bitget market lookup [${p.symbol}]:`, matches.slice(0, 5));
      }

      positions = list.map((p) => ({
        symbol: `${p.symbol}/USDT:USDT`,
        contracts: num(p.total),
        entryPrice: num(p.avgPrice),
        side: (p.posSide || p.holdSide || '').toLowerCase(), // UTA 用 posSide
        info: p,
      }));
    } else if (name === 'phemex' || name === 'mexc') {
      positions = await exchange.fetch_positions();
    } else {
      positions = await exchange.fetchPositions();
    }
  } catch (err) {
    console.error(`❌ ${name} positions:`, err.message);
    throw err; // 抛给上层 classifyError
  }

  const open = positions.filter((p) => p.contracts && p.contracts > 0);
  if (!open.length) return [];

  const symbols = [...new Set(open.map((p) => p.symbol))];
  const tickerCache = await buildTickerCache(exchange, symbols);
  const signFlip = NEGATIVE_FUNDING_SIGN.has(name) ? -1 : 1;

  const rows = await Promise.all(open.map(async (pos) => {
    // bitget UTA 暂不查 funding history（classic mix endpoint 会触发 40085）
    const allFunding = (name === 'bitget')
      ? []
      : await fetchFundingWindow(exchange, pos.symbol, sinceMs, nowMs);
    const totalFunding = allFunding.reduce((s, f) => s + num(f.amount), 0) * signFlip;

    let positionSize = pos.contracts;
    if (name === 'mexc') {
      const market = exchange.markets[pos.symbol];
      const contractSize = market?.contractSize || 1;
      positionSize = (pos.contracts || 0) * contractSize;
    }

    const ticker = tickerCache[pos.symbol];
    const { unrealizedPnl, positionValue, currentPrice, side } = computePnL(pos, ticker, positionSize);

    return {
      source: name,
      symbol: cleanSymbol(pos.symbol),
      rawSymbol: pos.symbol,
      side,
      currentPrice,
      entryPrice: pos.entryPrice || pos.entry_price || 0,
      positionSize,
      positionValue,
      unrealizedPnl,
      count: allFunding.length,
      totalFunding,
      fundingRecords: allFunding.map((f) => num(f.amount) * signFlip),
      fundingDetail: allFunding.map((f) => ({
        ts: f.timestamp,
        amount: num(f.amount) * signFlip,
      })),
      startTime: toSGTime(sinceMs),
      endTime: toSGTime(nowMs),
      windowMs: FUNDING_WINDOW_MS,
      serverNow: nowMs,
    };
  }));

  return rows;
}

// ---------- 订单 ----------
function formatOrder(o, name, exchange) {
  const triggerPrice = num(
    o.triggerPrice || o.stopPrice ||
    o.info?.stopPrice || o.info?.triggerPrice || 0
  );
  const limitPrice = num(o.price);
  const orderType = String(o.type || o.info?.type || 'LIMIT').toUpperCase();

  let kind = 'LIMIT';
  if (/TAKE_PROFIT|TAKEPROFIT/.test(orderType)) kind = 'TP';
  else if (/STOP/.test(orderType)) kind = 'SL';
  else if (triggerPrice && !limitPrice) kind = 'TRIGGER';

  const displayPrice = (kind === 'LIMIT')
    ? (limitPrice || triggerPrice)
    : (triggerPrice || limitPrice);

  let amount = num(o.amount || o.info?.origQty || o.info?.quantity || 0);
  if (name === 'mexc' && exchange && o.symbol) {
    const market = exchange.markets?.[o.symbol];
    const contractSize = market?.contractSize;
    if (contractSize && contractSize !== 1) {
      amount = amount * contractSize;
    }
  }

  return {
    exchange: name,
    symbol: cleanSymbol(o.symbol),
    side: name === 'mexc' ? convertMexcOrderSide(o.side) : o.side,
    price: displayPrice,
    triggerPrice,
    limitPrice,
    amount,
    kind,
    orderType,
  };
}

async function processExchangeOrders(name, exchange, positionRows) {
  const results = [];

  // bitget UTA：open orders 暂未接入原生 endpoint，返回空避免触发 classic 40085
  if (name === 'bitget') {
    return results;
  }

  try {
    if (name === 'binance') {
      const posSymbols = [...new Set(
        positionRows.filter((p) => p.source === name)
          .map((p) => p.rawSymbol || `${p.symbol}/USDT:USDT`)
      )];

      const perSymbol = await Promise.all(posSymbols.map(async (s) => {
        const [normal, triggers] = await Promise.all([
          exchange.fetchOpenOrders(s).catch(() => []),
          exchange.fetchOpenOrders(s, undefined, undefined, { stop: true }).catch(() => []),
        ]);
        return [...normal, ...triggers];
      }));
      results.push(...perSymbol.flat().map((o) => formatOrder(o, name, exchange)));
    } else if (name === 'phemex' || name === 'aster') {
      const posSymbols = [...new Set(
        positionRows.filter((p) => p.source === name)
          .map((p) => p.rawSymbol || `${p.symbol}/USDT:USDT`)
      )];
      const perSymbol = await Promise.all(
        posSymbols.map((s) => exchange.fetchOpenOrders(s).catch(() => []))
      );
      results.push(...perSymbol.flat().map((o) => formatOrder(o, name, exchange)));
    } else {
      const openOrders = await exchange.fetchOpenOrders().catch(() => []);
      results.push(...openOrders.map((o) => formatOrder(o, name, exchange)));
    }
  } catch (err) {
    console.error(`❌ ${name} orders:`, err.message);
  }

  return results.filter((o) => (o.price > 0 || o.triggerPrice > 0) && o.amount > 0);
}

function dedupeOrders(orders) {
  const seen = new Set();
  return orders.filter((o) => {
    const key = `${o.exchange}-${o.symbol}-${o.side}-${o.price}-${o.triggerPrice}-${o.amount}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------- 对冲健康度 ----------
function analyzeHedges(result) {
  const bySymbol = {};
  for (const r of result) {
    if (!bySymbol[r.symbol]) bySymbol[r.symbol] = { long: [], short: [] };
    if (r.side === 'long') bySymbol[r.symbol].long.push(r);
    else if (r.side === 'short') bySymbol[r.symbol].short.push(r);
  }

  const noProtection = [];
  const fundingLoss = [];
  const misaligned = [];

  for (const [symbol, sides] of Object.entries(bySymbol)) {
    const longSize = sides.long.reduce((s, r) => s + Math.abs(r.positionSize), 0);
    const shortSize = sides.short.reduce((s, r) => s + Math.abs(r.positionSize), 0);
    const longOrderCount = sides.long.reduce((s, r) => s + (r.tpSlClose?.length || 0), 0);
    const shortOrderCount = sides.short.reduce((s, r) => s + (r.tpSlClose?.length || 0), 0);
    const totalOrderCount = longOrderCount + shortOrderCount;
    const netFunding =
      sides.long.reduce((s, r) => s + r.totalFunding, 0) +
      sides.short.reduce((s, r) => s + r.totalFunding, 0);

    const allEntries = [...sides.long, ...sides.short];
    const hasAnyOrder = allEntries.some((r) => r.tpSlClose?.length);

    if (!hasAnyOrder && allEntries.length > 0) {
      noProtection.push({
        symbol, longSize, shortSize, netFunding,
        longCount: sides.long.length, shortCount: sides.short.length,
      });
    }

    if (netFunding < -0.5) {
      fundingLoss.push({
        symbol, longSize, shortSize, netFunding,
        longFunding: sides.long.reduce((s, r) => s + r.totalFunding, 0),
        shortFunding: sides.short.reduce((s, r) => s + r.totalFunding, 0),
      });
    }

    {
      const hasPair = sides.long.length && sides.short.length;
      const problems = [];

      if (!hasPair && allEntries.length > 0) {
        if (sides.long.length) problems.push(`裸多单，无对冲空头`);
        else problems.push(`裸空单，无对冲多头`);
      }

      if (hasPair) {
        const absDiff = Math.abs(longSize - shortSize);
        const sizeDiffPct = absDiff / Math.max(longSize, shortSize, 1);
        if (absDiff > 1e-8) {
          const dp = (longSize < 1 || shortSize < 1) ? 4 : (longSize < 100 ? 2 : 0);
          const lFmt = longSize.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
          const sFmt = shortSize.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
          problems.push(`Size 不对齐: L=${lFmt} vs S=${sFmt} (Δ${(sizeDiffPct * 100).toFixed(3)}%)`);
        }

        if (hasAnyOrder && longOrderCount !== shortOrderCount) {
          problems.push(`Order 数量不对齐: long=${longOrderCount} 单 vs short=${shortOrderCount} 单`);
        }
      }

      if (problems.length) {
        misaligned.push({
          symbol, longSize, shortSize,
          longOrderCount, shortOrderCount, totalOrderCount,
          netFunding, problems,
        });
      }
    }
  }

  fundingLoss.sort((a, b) => a.netFunding - b.netFunding);
  misaligned.sort((a, b) => {
    const aDiff = Math.abs(a.longSize - a.shortSize) / Math.max(a.longSize, a.shortSize, 1);
    const bDiff = Math.abs(b.longSize - b.shortSize) / Math.max(b.longSize, b.shortSize, 1);
    return bDiff - aDiff;
  });
  noProtection.sort((a, b) => b.longSize + b.shortSize - (a.longSize + a.shortSize));

  return { noProtection, fundingLoss, misaligned };
}

// ---------- 主 ----------
module.exports = async (req, res) => {
  const t0 = Date.now();
  const exchanges = buildExchanges();
  const nowMs = Date.now();
  const sinceMs = nowMs - FUNDING_WINDOW_MS;
  const exchangeList = Object.entries(exchanges);

  try {
    const exchangeStatus = {};

    const perExchangePromises = exchangeList.map(async ([name, exchange]) => {
      try {
        await exchange.loadMarkets();
      } catch (err) {
        const { type, message } = classifyError(err, name);
        console.error(`❌ ${name} loadMarkets:`, err.message);
        exchangeStatus[name] = { ok: false, error: message, errorType: type };
        return { name, equity: emptyWallet(), positions: [], failed: true };
      }

      let equityErr = null;
      let posErr = null;

      const [equity, positions] = await Promise.all([
        BALANCE_FETCHERS[name](exchange).catch((err) => {
          equityErr = err;
          console.error(`❌ ${name} balance:`, err.message);
          return emptyWallet();
        }),
        processExchangePositions(name, exchange, nowMs, sinceMs).catch((err) => {
          posErr = err;
          console.error(`❌ ${name} positions:`, err.message);
          return [];
        }),
      ]);

      const firstErr = equityErr || posErr;
      if (firstErr) {
        const { type, message } = classifyError(firstErr, name);
        exchangeStatus[name] = { ok: false, error: message, errorType: type };
      } else {
        exchangeStatus[name] = { ok: true, error: null, errorType: null };
      }

      return { name, equity, positions, failed: false };
    });

    const perExchange = await Promise.all(perExchangePromises);

    const equityOverview = {};
    const result = [];
    for (const { name, equity, positions } of perExchange) {
      equityOverview[name] = equity;
      result.push(...positions);
    }

    const phemexUnrealized = result
      .filter((r) => r.source === 'phemex')
      .reduce((s, r) => s + (r.unrealizedPnl || 0), 0);
    if (equityOverview.phemex) {
      equityOverview.phemex.total += phemexUnrealized;
      equityOverview.phemex.unrealizedPnl = phemexUnrealized;
    }

    const orderPromises = exchangeList.map(async ([name, exchange]) => {
      try {
        return await processExchangeOrders(name, exchange, result);
      } catch (err) {
        console.error(`❌ ${name} orders:`, err.message);
        return [];
      }
    });
    const ordersPerExchange = await Promise.all(orderPromises);
    const dedupedOrders = dedupeOrders(ordersPerExchange.flat());

    const orderIndex = new Map();
    for (const o of dedupedOrders) {
      const key = `${o.exchange}|${o.symbol.toUpperCase()}`;
      if (!orderIndex.has(key)) orderIndex.set(key, []);
      orderIndex.get(key).push({
        side: o.side,
        price: o.price,
        triggerPrice: o.triggerPrice,
        limitPrice: o.limitPrice,
        amount: o.amount,
        kind: o.kind,
        orderType: o.orderType,
      });
    }
    for (const pos of result) {
      const key = `${pos.source}|${pos.symbol.toUpperCase()}`;
      const related = orderIndex.get(key);
      if (related?.length) pos.tpSlClose = related;
    }

    const hedgeHealth = analyzeHedges(result);

    const totalEquity = Object.values(equityOverview).reduce(
      (s, ex) => s + (ex.total || 0), 0
    );

    const failedExchanges = Object.entries(exchangeStatus)
      .filter(([, s]) => !s.ok)
      .map(([name, s]) => ({ name, error: s.error, errorType: s.errorType }));

    const elapsed = Date.now() - t0;
    const okCount = Object.values(exchangeStatus).filter((s) => s.ok).length;
    console.log(
      `✅ ${elapsed}ms | exchanges ok=${okCount}/${exchangeList.length} | pos=${result.length}` +
      (failedExchanges.length ? ` | failed: ${failedExchanges.map(f => f.name).join(',')}` : '')
    );

    res.status(200).json({
      success: true,
      result,
      equityOverview,
      totalEquity,
      hedgeHealth,
      exchangeStatus,
      failedExchanges,
      serverNow: nowMs,
      windowMs: FUNDING_WINDOW_MS,
      elapsedMs: elapsed,
    });
  } catch (e) {
    console.error('❌ Fatal Error:', e);
    res.status(500).json({ success: false, error: classifyError(e).message, raw: e.message });
  }
};
