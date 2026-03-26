const https = require('https');

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const symbol = req.query.symbol || 'BTCUSDT';
  const url = `https://api.phemex.com/exchange/public/md/v2/kline/last?symbol=${encodeURIComponent('.' + symbol + 'FR8H')}&resolution=28800&limit=6`;

  https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (r) => {
    let data = '';
    r.on('data', c => data += c);
    r.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.status(200).send(data);
    });
  }).on('error', e => res.status(502).json({ error: e.message }));
};
