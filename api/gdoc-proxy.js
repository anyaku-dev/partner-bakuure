export default async function handler(req, res) {
  const docUrl = 'https://docs.google.com/document/d/e/2PACX-1vRON0qRusw-ReJWYTqB9M1rJK_9_QP8KYLBs81ZJXHw5rzySrEnQeF6zXr2OZMfwPe8P8zsJIKUOS8D/pub';

  try {
    const response = await fetch(docUrl);
    if (!response.ok) throw new Error(`Google Docs fetch failed: ${response.status}`);
    const html = await response.text();

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
