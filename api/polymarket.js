export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const today = new Date().toISOString().split('T')[0];
    const nextWeek = new Date(Date.now() + 7*86400000).toISOString().split('T')[0];
    const url = `https://gamma-api.polymarket.com/markets?limit=500&endDateMin=${today}&endDateMax=${nextWeek}&active=true`;
    const r = await fetch(url);
    const data = await r.json();
    const weather = (Array.isArray(data) ? data : []).filter(m =>
      /highest temperature in/i.test(m.question || '')
    );
    res.json(weather);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
