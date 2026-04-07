export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Search by question text directly
  const url = `https://gamma-api.polymarket.com/markets?_search=highest+temperature&limit=200`;
  const r = await fetch(url);
  const data = await r.json();
  res.json(data);
}
