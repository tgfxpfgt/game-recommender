/**
 * Game Recommender - 下载站搜索 / Download Site Search
 *
 * 多搜索词策略 + 跨语言匹配算法 + 链接匹配度评分；详情页元信息提取
 * （更新日期/版本/大小/网盘链接与提取码）；百度网盘链接拼接。
 * 正则提取统一走 utils.regexMatch / regexExecAll（纯正则匹配）。
 * Multi-term search with cross-language matching; detail-page meta extraction;
 * Baidu Pan URL concatenation. Regex extraction goes through the shared
 * regexMatch / regexExecAll helpers (pure regex matching).
 */
import { getDownloadSites } from '../core/rules.js';
import { fetchWithTimeout, regexMatch, regexExecAll } from '../core/utils.js';
import { cleanGameName, parseGameTitle } from '../steam/title-parser.js';
import { recordDownloadUrl } from '../storage/download-urls.js';

// 链接匹配度评分（0-100）：规范化后全等/包含/分段/跨语言独立比较
// Link match score (0-100): normalized equality/inclusion/segments/cross-language
export function calcLinkMatchScore(linkText, searchName) {
  const norm = s => (s || '').toLowerCase().replace(/[\s\-_:：|\/\.''!！?？\[\]()（）]/g, '');
  const nt = norm(linkText);
  const ns = norm(searchName);
  if (!nt || !ns || nt.length < 2 || ns.length < 2) return 0;
  if (nt === ns) return 100;
  if (nt.includes(ns)) return 85;
  if (ns.includes(nt) && nt.length >= 4) return 70;

  // 分段比较（按 | 和 / 拆分）/ Segment comparison
  const segments = linkText.split(/[|\/]/).map(s => norm(s)).filter(s => s.length >= 2);
  for (const seg of segments) {
    if (seg === ns) return 95;
    if (seg.includes(ns)) return 80;
    if (ns.includes(seg) && seg.length >= 4) return 65;
  }

  // 跨语言匹配：按非目标字符分段提取中英文子串，独立比较。
  // v3.3.10 数字保护：搜索词段含数字而链接段不含 → 该段不匹配——
  // "spiritofthenorth2"(二代) 不再匹配 "spiritofthenorth"(一代页)，
  // 防续作检索错配（与 nameMatchesSearch 的续作防护同思路）。
  // Cross-language matching with sequel-number protection (v3.3.10): when the
  // search segment carries a digit the link segment lacks, the pair is rejected.
  function splitLang(s) {
    const text = String(s || '');
    const en = text.split(/[^a-z0-9\s']+/i).map(norm).filter(m => m.length >= 2);
    const cn = text.split(/[^\u4e00-\u9fff\u3400-\u4dbf]+/).filter(m => m.length >= 2);
    return { en, cn };
  }

  const linkLang = splitLang(linkText);
  const searchLang = splitLang(searchName);

  // 数字保护：搜索词段有数字但链接段没有 → 拒绝该段（续作 vs 前作）
  // Digit guard: a search segment with digits must not match a digit-less link segment
  function digitGapRejects(se, le) {
    return /\d/.test(se) && !/\d/.test(le);
  }

  let enScore = 0;
  let cnScore = 0;

  if (searchLang.en.length > 0 && linkLang.en.length > 0) {
    let bestEn = 0;
    for (const se of searchLang.en) {
      for (const le of linkLang.en) {
        if (digitGapRejects(se, le)) continue;
        if (le === se) { bestEn = Math.max(bestEn, 100); }
        else if (le.includes(se) && se.length >= 4) { bestEn = Math.max(bestEn, 85); }
        else if (se.includes(le) && le.length >= 4) { bestEn = Math.max(bestEn, 75); }
      }
    }
    enScore = bestEn;
  }

  if (searchLang.cn.length > 0 && linkLang.cn.length > 0) {
    let bestCn = 0;
    for (const sc of searchLang.cn) {
      for (const lc of linkLang.cn) {
        if (digitGapRejects(sc, lc)) continue;
        if (lc === sc) { bestCn = Math.max(bestCn, 100); }
        else if (lc.includes(sc) && sc.length >= 2) { bestCn = Math.max(bestCn, 85); }
        else if (sc.includes(lc) && lc.length >= 2) { bestCn = Math.max(bestCn, 75); }
      }
    }
    cnScore = bestCn;
  }

  if (enScore > 0 && cnScore > 0) {
    return Math.round((enScore + cnScore) / 2);
  }
  return Math.max(enScore, cnScore);
}

// 详情页元信息提取（更新日期/版本/大小/网盘链接与提取码）
// Detail-page meta extraction (date/version/size/pan URL & code)
export function extractDetailMeta(html, siteKey) {
  const meta = { updateDate: '', version: '', size: '', panUrl: '', panCode: '' };
  if (!html) return meta;

  const h1Match = regexMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const h1Text = h1Match ? h1Match[1].replace(/<[^>]+>/g, '').trim() : '';

  // 更新日期
  const dateLabelMatch = regexMatch(html, /(?:更新时间|最近更新|发布日期)[^0-9]{0,15}([0-9]{4}[-\/年][0-9]{1,2}[-\/月][0-9]{1,2})/);
  if (dateLabelMatch) {
    meta.updateDate = dateLabelMatch[1].replace(/[年月]/g, '-').replace(/日$/, '');
  }

  // 版本 + 大小（按站点适配）
  if (siteKey === 'xdgame') {
    const verIntroMatch = regexMatch(html, /版本介绍<\/h[0-9]>\s*<p>([\s\S]*?)<\/p>/i);
    if (verIntroMatch) {
      const verLine = verIntroMatch[1].replace(/<[^>]+>/g, '');
      const vMatch = regexMatch(verLine, /\b([Vv]?\d+(?:\.\d+)+)\b/) || regexMatch(verLine, /(Build\.?\d+)/i);
      if (vMatch) meta.version = vMatch[1];
      const sizeMatch = regexMatch(verLine, /容量\s*([0-9.]+\s*(?:GB|MB|TB|G\b|M\b))/i);
      if (sizeMatch) meta.size = sizeMatch[1].trim();
    }
  }

  if (!meta.version && h1Text) {
    const h1Ver = regexMatch(h1Text, /\b([Vv]\d+(?:\.\d+)+)\b/) || regexMatch(h1Text, /(Build\.?\d+)/i);
    if (h1Ver) meta.version = h1Ver[1];
  }

  if (!meta.size) {
    const sizeLabelMatch = regexMatch(html, /(?:容量|游戏大小|文件大小|资源大小)[^0-9]{0,10}([0-9.]+\s*(?:GB|MB|TB))/i);
    if (sizeLabelMatch) meta.size = sizeLabelMatch[1].trim();
  }

  // 提取网盘链接（百度/阿里/115/夸克/微云），支持 <a href> 与纯文本
  const panUrlPattern = /https?:\/\/(?:pan\.baidu\.com\/(?:s\/[\w-]+|share\/init\?surl=[\w-]+)|aliyundrive\.com\/s\/[\w]+|alipan\.com\/s\/[\w]+|115\.com\/s\/[\w-]+|quark\.cn\/s\/[\w]+|weiyun\.com\/[\w]+)/i;
  const panUrlMatch = regexMatch(html, panUrlPattern);
  if (panUrlMatch) {
    meta.panUrl = panUrlMatch[0].replace(/&amp;/g, '&');

    // 在网盘链接附近查找提取码
    const idx = html.indexOf(panUrlMatch[0]);
    const nearby = html.substring(Math.max(0, idx - 300), idx + panUrlMatch[0].length + 500);
    const codeMatch = regexMatch(nearby, /(?:提取码|密码|访问码|pwd|access\s*code)[：:\s]*([a-zA-Z0-9]{4,6})/i);
    if (codeMatch) meta.panCode = codeMatch[1];
  }

  return meta;
}

// 搜索指定游戏在各下载站的资源（siteKeys 为空时搜索全部）
// Search download sites for a game (siteKeys = null → all configured sites)
export async function searchDownloadSites(gameName, appId, siteKeys = null) {
  const results = [];
  // 仅检索指定的站点
  const allSites = await getDownloadSites();
  const sitesToSearch = siteKeys
    ? allSites.filter(s => siteKeys.includes(s.key))
    : allSites;

  // 生成多个搜索词，按优先级排序：清洗主名 → parseGameTitle 候选 → 原始名
  const searchTerms = [];
  const seenTerms = new Set();
  function addTerm(t) {
    const key = t.toLowerCase().trim();
    if (key.length >= 2 && !seenTerms.has(key)) {
      seenTerms.add(key);
      searchTerms.push(t);
    }
  }
  addTerm(cleanGameName(gameName) || gameName);
  parseGameTitle(gameName).forEach(t => addTerm(t));
  addTerm(gameName);

  for (const site of sitesToSearch) {
    const primaryTerm = searchTerms[0];
    const result = {
      key: site.key, name: site.name, found: false,
      detailUrl: '', searchUrl: site.searchUrl(primaryTerm),
      updateDate: '', version: '', size: '', panUrl: '', panCode: ''
    };
    try {
      // 依次尝试每个搜索词，找到匹配就停止
      let bestUrl = '';
      let bestScore = 0;
      let usedTerm = primaryTerm;

      for (let termIdx = 0; termIdx < searchTerms.length; termIdx++) {
        const term = searchTerms[termIdx];
        const resp = await fetchWithTimeout(site.searchUrl(term), {
          headers: { 'Accept-Language': 'zh-CN,zh;q=0.9' }
        });
        if (!resp.ok) continue;
        const html = await resp.text();

        // 提取候选详情链接：文本为空时回退 title 属性（WordPress 图片链接场景）
        // Candidate detail links; fall back to the title attribute when the
        // link text is empty (WordPress image-only links)
        const candidates = [];
        const linkMatches = regexExecAll(html, /<a([^>]*)href="([^"]*(?:\/\d+\.html?|\/game\/\d+[^"]*))"([^>]*)>([\s\S]*?)<\/a>/gi);
        for (const lm of linkMatches) {
          const href = lm[2];
          const text = lm[4].replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
          const titleAttr = regexMatch(lm[1] + lm[3], /title="([^"]*)"/i);
          const titleText = titleAttr ? titleAttr[1].replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim() : '';
          candidates.push({ href, text: text || titleText });
        }

        // 按文本匹配度选出最符合游戏名的链接
        for (const c of candidates) {
          let maxScore = 0;
          for (const t of searchTerms) {
            maxScore = Math.max(maxScore, calcLinkMatchScore(c.text, t));
          }
          maxScore = Math.max(maxScore, calcLinkMatchScore(c.text, gameName));
          if (maxScore > bestScore) {
            bestScore = maxScore;
            bestUrl = c.href;
            usedTerm = term;
          }
        }

        // 已经找到高分匹配，不再尝试更多搜索词
        if (bestScore >= 80) break;
      }

      // 更新搜索URL为实际使用的那个
      result.searchUrl = site.searchUrl(usedTerm);

      if (bestUrl && bestScore >= 60) {
        const detailUrl = bestUrl.startsWith('http') ? bestUrl : site.base + (bestUrl.startsWith('/') ? '' : '/') + bestUrl;
        result.found = true;
        result.detailUrl = detailUrl;
        // 记录到下载站网址缓存（以 appId 为键，30 天有效，新网址替代旧网址）。
        // v3.3.10：仅高分（≥80）结果写缓存——低分/模糊匹配不固化，
        // 防止误匹配结果污染 30 天缓存（如二代词匹配到一代页面 75 分）
        if (appId && bestScore >= 80) {
          await recordDownloadUrl(appId, site.key, site.name, detailUrl);
        }
        try {
          const dResp = await fetchWithTimeout(detailUrl, { headers: { 'Accept-Language': 'zh-CN,zh;q=0.9' } });
          if (dResp.ok) {
            const dHtml = await dResp.text();
            const meta = extractDetailMeta(dHtml, site.key);
            result.updateDate = meta.updateDate;
            result.version = meta.version;
            result.size = meta.size;
            result.panUrl = meta.panUrl;
            result.panCode = meta.panCode;
            // 百度网盘自动拼接提取码
            if (result.panUrl && result.panCode && /pan\.baidu\.com/i.test(result.panUrl)) {
              result.panUrl = buildBaiduPanUrlWithPwd(result.panUrl, result.panCode);
            }
          }
        } catch (e) {
          // 详情页元信息抓取失败不影响搜索结果
          console.log(`获取${site.name}详情页元信息失败:`, e.message);
        }
      }
    } catch (e) {
      console.log(`搜索${site.name}失败:`, e.message);
    }
    results.push(result);
  }
  return results;
}

// 百度网盘链接拼接提取码，支持自动填充 / Build Baidu Pan URL with extraction code
export function buildBaiduPanUrlWithPwd(url, pwd) {
  if (!url || !pwd) return url;
  try {
    const u = new URL(url);
    // 安全检查：只允许百度网盘域名
    if (!/pan\.baidu\.com$/i.test(u.hostname)) {
      console.warn('buildBaiduPanUrlWithPwd: 非百度网盘链接被拒绝:', url);
      return url;
    }
    // 已经有pwd参数则不重复添加
    if (u.searchParams.has('pwd')) return url;
    u.searchParams.set('pwd', pwd);
    return u.toString();
  } catch (e) {
    // URL解析失败，简单拼接
    if (url.includes('?')) {
      return url + '&pwd=' + encodeURIComponent(pwd);
    } else {
      return url + '?pwd=' + encodeURIComponent(pwd);
    }
  }
}
