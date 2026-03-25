const https = require('https');

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const symbol = req.query.symbol || 'BTCUSDT';

  // Try 4H first (most common for Phemex USDT pairs), fallback to 8H
  const sym4H = `.${symbol}FR4H`;
  const url4H = `https://api.phemex.com/exchange/public/md/v2/kline/last?symbol=${encodeURIComponent(sym4H)}&resolution=14400&limit=12`;

  https.get(url4H, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (r) => {
    let data = '';
    r.on('data', c => data += c);
    r.on('end', () => {
      try {
        const json = JSON.parse(data);
        const rows = json?.data?.rows || [];
        if (rows.length > 0) {
          // 4H has data — return it
          res.setHeader('Content-Type', 'application/json');
          res.status(200).json({ code: 0, msg: 'OK', data: { rows } });
        } else {
          // Fallback to 8H
          const sym8H = `.${symbol}FR8H`;
          const url8H = `https://api.phemex.com/exchange/public/md/v2/kline/last?symbol=${encodeURIComponent(sym8H)}&resolution=28800&limit=6`;
          https.get(url8H, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (r2) => {
            let d2 = '';
            r2.on('data', c => d2 += c);
            r2.on('end', () => {
              res.setHeader('Content-Type', 'application/json');
              res.status(200).send(d2);
            });
          }).on('error', e => res.status(502).json({ error: e.message }));
        }
      } catch(e) {
        res.status(502).json({ error: e.message });
      }
    });
  }).on('error', e => res.status(502).json({ error: e.message }));
};
