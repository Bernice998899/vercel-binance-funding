const https = require('https');

function fetchKline(symbol, resolution, limit) {
  return new Promise((resolve) => {
    const url = `https://api.phemex.com/exchange/public/md/v2/kline/last?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&limit=${limit}`;
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (r) => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => {
        try { resolve(JSON.parse(data)?.data?.rows || []); }
        catch { resolve([]); }
      });
    }).on('error', () => resolve([]));
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const symbol = req.query.symbol || 'BTCUSDT';

  // Fetch all 3 intervals, return ALL rows — HTML will filter by 48h
  const [rows1h, rows4h, rows8h] = await Promise.all([
    fetchKline(`.${symbol}FR1H`, 3600, 48),
    fetchKline(`.${symbol}FR4H`, 14400, 12),
    fetchKline(`.${symbol}FR8H`, 28800, 6),
  ]);

  // Deduplicate by timestamp only
  const seen = new Set();
  const merged = [];
  for (const row of [...rows1h, ...rows4h, ...rows8h]) {
    if (!seen.has(row[0])) {
      seen.add(row[0]);
      merged.push(row);
    }
  }

  res.setHeader('Content-Type', 'application/json');
  res.status(200).json({ code: 0, msg: 'OK', data: { rows: merged } });
};
