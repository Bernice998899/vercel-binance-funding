export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { ids } = req.query;
  const url = `https://aviationweather.gov/api/data/metar?ids=${ids}&format=json`;
  const r = await fetch(url);
  const data = await r.json();
  res.json(data);
}
