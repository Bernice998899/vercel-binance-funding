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

  // Fetch 8H first (always works)
  getKline(`.${symbol}FR8H`, 28800, 6, rows8h => {
    // Also fetch 4H (captures intermediate settlements)
    getKline(`.${symbol}FR4H`, 14400, 12, rows4h => {
      // Merge, deduplicate by timestamp
      const seen = new Set();
      const merged = [];
      for (const row of [...rows4h, ...rows8h]) {
        if (!seen.has(row[0])) { seen.add(row[0]); merged.push(row); }
      }
      // If 4H has data, use merged. If not, use 8H only
      const result = rows4h.length > 0 ? merged : rows8h;
      res.setHeader('Content-Type', 'application/json');
      res.status(200).json({ code: 0, msg: 'OK', data: { rows: result } });
    });
  });
};
