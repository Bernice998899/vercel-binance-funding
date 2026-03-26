const https = require('https');

function getKline(sym, resolution, limit, cb) {
  const url = `https://api.phemex.com/exchange/public/md/v2/kline/last?symbol=${encodeURIComponent(sym)}&resolution=${resolution}&limit=${limit}`;
  https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, r => {
    let d = '';
    r.on('data', c => d += c);
    r.on('end', () => { try { cb(JSON.parse(d)?.data?.rows || []); } catch { cb([]); } });
  }).on('error', () => cb([]));
}

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const symbol = req.query.symbol || 'BTCUSDT';

  // Try 4H first (12 candles = 2 days exact)
  getKline(`.${symbol}FR4H`, 14400, 12, rows4h => {
    if (rows4h.length > 0) {
      return res.status(200).json({ code:0, msg:'OK', data:{ rows:rows4h }, interval:14400 });
    }
    // Fallback 8H (6 candles = 2 days)
    getKline(`.${symbol}FR8H`, 28800, 6, rows8h => {
      res.status(200).json({ code:0, msg:'OK', data:{ rows:rows8h }, interval:28800 });
    });
  });
};
