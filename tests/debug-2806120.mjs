// 临时调试：2806120 生化女神 xianyudanji 检索
'use strict';
globalThis.chrome = { runtime: {}, storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } } };
for (const f of ['default.js', 'sites/xdgame.js', 'sites/xianyudanji.js', 'sites/gamer520.js', 'sites/3dmgame.js', 'sites/ali213.js', 'sites/gamersky.js', 'index.js']) {
  await import('file:///F:/data/browser%20extension/game-recommender/adapters/' + f + '?t=' + Date.now());
}
const { searchDownloadSites } = await import('file:///F:/data/browser%20extension/game-recommender/background/sites/search.js?t=' + Date.now());

// 1. 完整检索（Steam 页 gameName）
const sites = await searchDownloadSites('Bio Goddess : Doomsday Begins', '2806120', ['xdgame', 'xianyudanji', 'gamer520']);
for (const s of sites) {
  console.log(`${s.key}: found=${s.found} detail=${s.detailUrl}`);
}

// 2. xianyudanji 站内搜索 中英文名 原始结果
async function get(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36', 'Accept-Language': 'zh-CN,zh;q=0.9' } });
    return { status: r.status, text: await r.text() };
  } catch (e) { return { error: e.message }; }
}
for (const term of ['Bio Goddess', '生化女神', '生化女神 末日开端', 'Bio Goddess Doomsday']) {
  const r = await get('https://www.xianyudanji.gg/?s=' + encodeURIComponent(term));
  const links = [];
  const re = /<a[^>]*href="([^"]*(?:\/\d+\.html?))"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(r.text)) !== null) {
    const text = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const title = (m[0].match(/title="([^"]*)"/) || [])[1] || '';
    links.push((text || title).slice(0, 50));
  }
  console.log(`xianyudanji ?s="${term}":`, links.slice(0, 3).join(' | ') || '(无结果)');
}
