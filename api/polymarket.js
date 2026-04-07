export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // tag_slug=temperature matches the 185 temperature markets on the website
  const url = `https://gamma-api.polymarket.com/markets?tag_slug=temperature&limit=500&active=true&closed=false`;
  const r = await fetch(url);
  const data = await r.json();
  res.json(data);
}
