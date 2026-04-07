export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    // Fetch multiple pages to find temperature markets
    const results = [];
    for (let offset = 0; offset < 3000; offset += 500) {
      const url = `https://gamma-api.polymarket.com/markets?limit=500&offset=${offset}&active=true&closed=false`;
      const r = await fetch(url);
      const data = await r.json();
      if (!data || data.length === 0) break;
      const weather = data.filter(m => 
        /highest temperature in/i.test(m.question || '')
      );
      results.push(...weather);
      if (weather.length > 0) break; // Found some, stop
    }
    res.json(results);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
