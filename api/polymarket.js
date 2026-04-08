export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    // Fetch active temperature events directly
    const url = `https://gamma-api.polymarket.com/events?limit=200&active=true&tag_slug=temperature`;
    const r = await fetch(url);
    const data = await r.json();
    // Flatten markets from events
    const markets = [];
    for (const e of (Array.isArray(data) ? data : [])) {
      for (const m of (e.markets || [])) {
        markets.push({ ...m, eventTitle: e.title, endDate: e.endDate });
      }
    }
    res.json(markets.length > 0 ? markets : { raw: data });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
