const https = require('https');
const crypto = require('crypto');

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const symbol    = req.query.symbol || 'BTCUSDT';
  const limit     = parseInt(req.query.limit) || 50;
  const apiKey    = process.env.PHEMEX_API_KEY;
  const apiSecret = process.env.PHEMEX_API_SECRET;

  const end    = Date.now();
  const start  = end - 48 * 3600 * 1000;  // last 48 hours in ms

  const path        = '/api-data/public/data/funding-rate-history';
  const queryString = `symbol=${symbol}&start=${start}&end=${end}&limit=${limit}`;
  const expiry      = Math.floor(Date.now() / 1000) + 60;

  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(path + queryString + expiry)
    .digest('hex');

  const options = {
    hostname: 'api.phemex.com',
    path: `${path}?${queryString}`,
    method: 'GET',
    headers: {
      'x-phemex-access-token':      apiKey,
      'x-phemex-request-expiry':    expiry,
      'x-phemex-request-signature': signature,
      'Content-Type': 'application/json',
    }
  };

  const request = https.request(options, r => {
    let data = '';
    r.on('data', c => data += c);
    r.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.status(200).send(data);
    });
  });

  request.on('error', e => res.status(502).json({ error: e.message }));
  request.end();
};
