const https = require('https');

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const symbol = req.query.symbol  'BTCUSDT';
  const limit  = req.query.limit   50;

  // Try 4H first, then 8H if empty
  // Phemex funding rate kline: .BTCUSDTFR4H (resolution=14400) or .BTCUSDTFR8H (resolution=28800)
  const sym4H = .${symbol}FR4H;
  const url = `https://api.phemex.com/exchange/public/md/v2/kline/last?symbol=${encodeURIComponent(sym4H)}&resolution=14400&limit=${limit}`;

  https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (r) => {
    let data = '';
    r.on('data', c => data += c);
    r.on('end', () => {
      try {
        const json = JSON.parse(data);
        const rows = json?.data?.rows || [];
        // If no 4H data, try 8H
        if (!rows.length) {
          const sym8H = .${symbol}FR8H;
          const url8 = `https://api.phemex.com/exchange/public/md/v2/kline/last?symbol=${encodeURIComponent(sym8H)}&resolution=28800&limit=${limit}`;
          https.get(url8, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (r2) => {
            let d2 = '';
            r2.on('data', c => d2 += c);
            r2.on('end', () => {
              res.setHeader('Content-Type', 'application/json');
              res.status(200).send(d2);
            });
          }).on('error', e => res.status(502).json({ error: e.message }));
        } else {
          res.setHeader('Content-Type', 'application/json');
          res.status(200).send(data);
        }
      } catch(e) {
        res.setHeader('Content-Type', 'application/json');
        res.status(200).send(data);
      }
    });
  }).on('error', (e) => {
    res.status(502).json({ error: e.message });
  });
};
