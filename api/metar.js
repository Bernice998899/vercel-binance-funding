export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { ids } = req.query;
  try {
    const url = `https://aviationweather.gov/api/data/metar?ids=${ids}&format=json`;
    const r = await fetch(url);
    if (!r.ok) {
      res.status(500).json({ error: `Aviation weather error: ${r.status}` });
      return;
    }
    const data = await r.json();
    res.json(data);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
