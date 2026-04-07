export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    // Daily temperature markets end today — filter by end date
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const url = `https://gamma-api.polymarket.com/markets?limit=500&endDateMin=${today}&endDateMax=${tomorrow}`;
    const r = await fetch(url);
    const data = await r.json();
    res.json(Array.isArray(data) ? data : { raw: data });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
