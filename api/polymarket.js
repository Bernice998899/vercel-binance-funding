export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const url = `https://data-api.polymarket.com/positions?user=0x594edb9112f526fa6a80b8f858a6379c8a2c1c11&sizeThreshold=0&limit=500`;
    const r = await fetch(url);
    const data = await r.json();
    // Only active positions: curPrice between 0.01 and 0.99
    const active = (Array.isArray(data) ? data : []).filter(m => {
      const p = parseFloat(m.curPrice);
      return p > 0.01 && p < 0.99;
    });
    res.json(active);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
