export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const url = `https://gamma-api.polymarket.com/markets?limit=1000&active=true`;
  const r = await fetch(url);
  const data = await r.json();
  res.json(data);
}
