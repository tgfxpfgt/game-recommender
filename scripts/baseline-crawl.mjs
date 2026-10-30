/**
 * 游戏雷达 Game Radar - 基准采集脚本（第八轮批次 13 / 用户需求）
 *
 * 以当前 3 个下载站列表页**第一页**为基准：
 *   1. 抓取首页列表项（url + 标题，按各站详情 URL 形态过滤）
 *   2. 抓取每条详情页，提取 ground-truth steam appid（站点自身内嵌信号：
 *      Steam 链接 / steamstatic 图片 / data-appid）
 *   3. 对每个标题逐词调用真实 storesearch 录制响应（150ms 节流）
 *   4. 产出 tests/fixtures/baseline-firstpage.json（错题库同构格式）——
 *      tests/unit/test-baseline-firstpage.mjs 以此为回放基准
 * 用法：node scripts/baseline-crawl.mjs [--per-site=10]
 * 只写 fixtures 文件，不改任何代码；可重复运行刷新基准。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { parseGameTitle } from '../background/core/title-parser.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const PER_SITE = Number(process.argv.find((a) => a.startsWith('--per-site='))?.split('=')[1]) || 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SITES = [
  {
    key: 'xianyudanji',
    firstPage: 'https://www.xianyudanji.gg/pcdj', // v14.8 批次 16：游戏列表页第一页（用户指定基准）
    detail: /^\/\d+\.html$/,
    base: 'https://www.xianyudanji.gg'
  },
  {
    key: 'xdgame',
    firstPage: 'https://www.xdgame.com/list/1/',
    detail: /^\/game\/\d+\.html$/,
    base: 'https://www.xdgame.com'
  },
  {
    key: 'gamer520',
    firstPage: 'https://www.gamer520.com/pcplay',
    detail: /^\/\d+\.html$/,
    base: 'https://www.gamer520.com'
  }
];

/** HTML 实体解码（对齐 DOM textContent 语义——站点标题含 &#039; 等） */
function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}

async function get(url) {
  const resp = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.text();
}

/** 从首页 HTML 提取列表项（详情形态过滤 + 锚文本标题，去重保序） */
function extractItems(html, site) {
  const items = [];
  const seen = new Set();
  const re = /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    const path = href.startsWith('http') ? href.replace(/^https?:\/\/[^/]+/, '') : href;
    if (!site.detail.test(path)) continue;
    const title = decodeEntities(m[2].replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
    if (title.length < 6 || title.length > 120) continue;
    const url = href.startsWith('http') ? href : site.base + path;
    if (seen.has(url)) continue;
    seen.add(url);
    items.push({ url, title });
  }
  return items.slice(0, PER_SITE);
}

/** 详情页 HTML → ground-truth steam appid（多信号按优先级） */
function extractGroundTruthAppId(html) {
  const patterns = [
    /store\.steampowered\.com\/app\/(\d+)/i,
    // host 无关：三站图片均走 CDN 镜像（queniuqe.com 等），路径形态一致
    /store_item_assets\/steam\/apps\/(\d+)/i,
    /steamapps\/apps\/(\d+)\//i,
    /data-appid="(\d+)"/i,
    /steamAppId["']?\s*[:=]\s*["']?(\d+)/i
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[m.length - 1];
  }
  return null;
}

/** 逐词真实 storesearch 录制（150ms 节流） */
async function recordStoresearch(terms) {
  const recorded = {};
  for (const term of terms) {
    try {
      const resp = await fetch(
        `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=schinese&cc=cn`,
        { headers: { 'User-Agent': UA } }
      );
      recorded[term] = await resp.json();
    } catch (e) {
      recorded[term] = { total: 0, items: [], error: String(e) };
    }
    await sleep(200);
  }
  return recorded;
}

// ============ 主流程 ============
const samples = [];
for (const site of SITES) {
  console.log(`\n===== ${site.key}：抓取首页 ${site.firstPage}`);
  let html = '';
  try {
    html = await get(site.firstPage);
  } catch (e) {
    console.error(`  首页抓取失败（跳过该站）: ${e.message}`);
    continue;
  }
  const items = extractItems(html, site);
  console.log(`  列表项: ${items.length}`);
  for (const item of items) {
    await sleep(300);
    let ground = null;
    try {
      const detailHtml = await get(item.url);
      ground = extractGroundTruthAppId(detailHtml);
    } catch (e) {
      console.log(`  详情抓取失败（跳过）: ${item.url} ${e.message}`);
      continue;
    }
    if (!ground) {
      console.log(`  无 ground-truth（跳过）: ${item.title.slice(0, 40)}`);
      continue;
    }
    // 零解析词过滤：标题无可搜索词（"v2.5.0" 型更新贴）——搜索路径不可判定
    if (parseGameTitle(item.title).length === 0) {
      console.log(`  零解析词（跳过）: ${item.title.slice(0, 40)}`);
      continue;
    }
    // 垃圾条目过滤：固件/汇总贴/补丁贴（复用游戏封面图 → ground-truth 误标）
    if (/(汇总贴|固件|修复补丁|整合包系统)/i.test(item.title)) {
      console.log(`  非游戏条目（跳过）: ${item.title.slice(0, 40)}`);
      continue;
    }
    // 同 appid 去重（置顶贴复用封面会重复映射）
    if (samples.some((s) => s.expectedAppId === ground)) {
      console.log(`  appid 重复（跳过）: ${ground} ${item.title.slice(0, 30)}`);
      continue;
    }
    const terms = parseGameTitle(item.title).slice(0, 6);
    console.log(`  [${site.key}] "${item.title.slice(0, 44)}" → appid ${ground}（${terms.length} 词）`);
    const recorded = await recordStoresearch(terms);
    // 英文重搜录制（管线阶段 2 交叉验证会发 l=english 请求——不录则回放失真）
    const enSegment = (item.title.match(/[A-Za-z][A-Za-z0-9 &:.'\-]{5,}/) || [''])[0].trim();
    if (enSegment) {
      try {
        const resp = await fetch(
          `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(enSegment)}&l=english&cc=cn`,
          { headers: { 'User-Agent': UA } }
        );
        recorded[enSegment] = await resp.json();
      } catch (e) {
        recorded[enSegment] = { total: 0, items: [], error: String(e) };
      }
      await sleep(200);
      // 去数字变体（de-digit 循环同源）
      const deDigit = enSegment.replace(/\d+/g, ' ').replace(/\s+/g, ' ').trim();
      if (deDigit.length >= 2 && deDigit !== enSegment) {
        try {
          const resp2 = await fetch(
            `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(deDigit)}&l=english&cc=cn`,
            { headers: { 'User-Agent': UA } }
          );
          recorded[deDigit] = await resp2.json();
        } catch (e) {
          recorded[deDigit] = { total: 0, items: [], error: String(e) };
        }
        await sleep(200);
      }
    }
    samples.push({
      id: `${site.key}-${ground}-${samples.length}`,
      site: site.key,
      pageUrl: item.url,
      rawTitle: item.title,
      expectedAppId: ground,
      expectedName: '',
      note: '三站第一页基准采集',
      recorded
    });
  }
}

mkdirSync(new URL('../tests/fixtures/', import.meta.url), { recursive: true });
const out = new URL('../tests/fixtures/baseline-firstpage.json', import.meta.url);
writeFileSync(out, JSON.stringify({ v: 1, generatedAt: new Date().toISOString(), samples }, null, 2));
console.log(`\n✅ 基准写入 ${out.pathname.slice(1)}：${samples.length} 条样本`);
