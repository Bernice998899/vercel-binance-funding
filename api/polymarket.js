export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    // Sort by newest first — daily temperature markets are freshly created
    const url = `https://gamma-api.polymarket.com/markets?limit=500&active=true&closed=false&sort=startDate&order=DESC`;
    const r = await fetch(url);
    const data = await r.json();
    const weather = data.filter(m =>
      /highest temperature in/i.test(m.question || '')
    );
    res.json(weather.length > 0 ? weather : data.slice(0, 5));
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
