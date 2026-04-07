export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Use events API with weather tag — this is what the website uses
  const url = `https://gamma-api.polymarket.com/events?tag=weather&limit=200&active=true`;
  const r = await fetch(url);
  const data = await r.json();
  // Flatten: extract all markets from events
  const markets = [];
  for (const event of data) {
    if (event.markets) markets.push(...event.markets);
  }
  res.json(markets);
}
