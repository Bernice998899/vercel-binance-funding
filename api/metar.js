import https from 'https';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { ids } = req.query;
  const url = `https://aviationweather.gov/api/data/metar?ids=${ids}&format=json`;
  
  https.get(url, (r) => {
    let data = '';
    r.on('data', chunk => data += chunk);
    r.on('end', () => {
      try {
        res.json(JSON.parse(data));
      } catch(e) {
        res.status(500).json({ error: 'Parse failed', raw: data.slice(0, 200) });
      }
    });
  }).on('error', e => res.status(500).json({ error: e.message }));
}
