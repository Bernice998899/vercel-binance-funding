export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const url = `https://gamma-api.polymarket.com/markets?limit=200&active=true&closed=false&sortBy=createdAt&order=DESC`;
    const r = await fetch(url);
    const data = await r.json();
    const weather = (Array.isArray(data) ? data : []).filter(m =>
      /highest temperature in/i.test(m.question || '')
    );
    // Return weather matches, or first 3 for debug if empty
    res.json({ found: weather.length, weather, debug: Array.isArray(data) ? data.slice(0,3) : data });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
