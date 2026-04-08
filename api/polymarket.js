export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const url = `https://gamma-api.polymarket.com/events?limit=200&active=true`;
    const r = await fetch(url);
    const data = await r.json();
    // Return raw so we can inspect structure
    res.json(Array.isArray(data) ? data.slice(0, 5) : data);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
