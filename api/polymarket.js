export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const today = new Date().toISOString().split('T')[0];
    const url = `https://gamma-api.polymarket.com/events?limit=200&tag_slug=temperature&startDateMin=${today}`;
    const r = await fetch(url);
    const data = await r.json();
    const markets = [];
    for (const e of (Array.isArray(data) ? data : [])) {
      for (const m of (e.markets || [])) {
        markets.push({ ...m, eventTitle: e.title, endDate: e.endDate || m.endDate });
      }
    }
    res.json({ count: markets.length, markets: markets.slice(0, 20), raw_events: Array.isArray(data) ? data.slice(0,2) : data });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
