// api/proxy.js
// 通用 CORS 代理 —— 放进你的 vercel-binance-funding 项目的 api/ 目录即可。
// 和 Cloudflare Worker 完全相同的契约：/api/proxy?url=<encodeURIComponent(目标地址)>
// 用途：让 dashboard 的 Binance / Aster / Bybit / Bitget / Gate 全部走服务器端转发，
//      绕开浏览器 CORS（null-origin）和马来本地对 Binance 的地区限制。
// Phemex 仍走你现有的 /api/phemex-ticker，不受影响。
//
// 部署后，在面板 ☰「Worker 代理」栏填：
//      https://vercel-binance-funding.vercel.app/api/proxy?url=
// 再打开「全部走 Worker 代理」开关即可（这个开关已支持任意 ?url= 代理，不限 Cloudflare）。

const ALLOW = [
  'fapi.binance.com',
  'fapi.asterdex.com',
  'api.bybit.com',
  'api.bitget.com',
  'api.gateio.ws',
  'api.phemex.com',
  'cdn.jsdelivr.net',
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const target = req.query.url;
  if (!target) return res.status(400).json({ error: 'missing ?url=' });

  let dest;
  try {
    dest = new URL(target);
  } catch {
    return res.status(400).json({ error: 'bad url' });
  }
  if (dest.protocol !== 'https:') return res.status(400).json({ error: 'https only' });

  const ok = ALLOW.some(h => dest.hostname === h || dest.hostname.endsWith('.' + h));
  if (!ok) return res.status(403).json({ error: 'host not allowed: ' + dest.hostname });

  try {
    const upstream = await fetch(dest.toString(), {
      method: req.method,
      headers: { accept: 'application/json', 'user-agent': 'kai-proxy/1.0' },
      body: req.method === 'POST' ? JSON.stringify(req.body || {}) : undefined,
    });
    const text = await upstream.text();
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    // 轻量缓存，降低对上游的请求频率（可按需删除）
    res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate=10');
    return res.status(upstream.status).send(text);
  } catch (e) {
    return res.status(502).json({ error: 'upstream: ' + String(e) });
  }
}

// 可选：若 Binance 从 Vercel 默认区域返回 451（地区限制），
// 在项目根目录建 vercel.json 把函数固定到新加坡区域（和你 Cloud Run 一致）：
// {
//   "functions": { "api/proxy.js": { "regions": ["sin1"] } }
// }
