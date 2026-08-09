/**
 * Game Recommender - 游戏标题解析 / Game Title Parser
 *
 * 从下载站标题中解析可用于 Steam 搜索的候选名称（去噪声、分段、
 * 中英文子串提取、优先级排序）。
 * Parses searchable name candidates from download-site titles (noise removal,
 * segmentation, CN/EN substring extraction, priority ordering).
 */

// 噪声词表（下载站标题常见修饰/版本词）/ Noise keywords in download-site titles
const noisePattern = /(中文|汉化|破解|免安装|绿色|学习|未加密|完整版|豪华版|豪华|终极|数字|典藏|年度|重制|复刻|增强|正式|官方|简繁|简体|繁体|中英|多语言|特别版|标准版|解压即撸|预购特典|预购|特典|版|v[\d.]+|V[\d.]+|\d+\.\d+[\d.]*|Build[.\s]*\d+|update\s*\d+|DLC.*|全DLC|整合|硬盘|免DVD|CODEX|FLT|RELOADED|SKIDROW|EMPRESS|GOG|Razor1911|FitGirl|\d+\s*GB|百度网盘|网盘|下载|迅雷|磁力|BT|种子|支持手柄|手柄|支持|新游发布|免安装绿色版|\s+The\s+Game\s*)/gi;

// 判断整段是否仅由噪声词组成 / Is a segment pure noise?
function isPureNoise(text) {
  const stripped = text.replace(noisePattern, '').replace(/[\s\|\-:：、]+/g, '');
  return stripped.length === 0;
}

/**
 * 解析游戏标题为搜索候选列表（最多 5 个，按优先级排序）
 * 分段规则：|、" -" 及中文分隔符 ×•·（× 常见于译名如"地城英雄×龙与地下城"）。
 * Parse a title into search candidates (max 5, priority-ordered).
 * Segmentation: |, spaced dashes and CN separators ×•·.
 */
export function parseGameTitle(rawName) {
  if (!rawName) return [];

  let name = rawName.trim();

  // 移除括号内容（中英文括号）及书名号 / Strip bracket contents and book marks
  name = name.replace(/[\(\[\【].*?[\)\]\】]/g, '');
  name = name.replace(/[《》]/g, '');

  const rawParts = name.split(/[|]+|\s+[-–—]\s+|[×•·]/).map(s => s.trim()).filter(s => s.length > 1);

  const candidates = [];
  const seen = new Set();
  function addCandidate(text) {
    const t = text.trim().replace(/\s+/g, ' ');
    if (t.length >= 2 && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      candidates.push(t);
    }
  }

  for (const part of rawParts) {
    if (isPureNoise(part)) continue;

    // 1) 整段清洗后作为候选（保留主名，去掉噪声词）
    const cleaned = part.replace(noisePattern, ' ').replace(/\s+/g, ' ').trim();
    if (cleaned.length >= 2) addCandidate(cleaned);

    // 2) 英文子串作为补充候选
    const en = part.match(/[A-Za-z][A-Za-z0-9\s':&.!\-]+[A-Za-z0-9'.!]?/g);
    if (en) en.forEach(m => {
      const cleanedEn = m.replace(noisePattern, ' ').replace(/\s+/g, ' ').trim();
      if (cleanedEn.length >= 2) addCandidate(cleanedEn);
    });

    // 3) 中文子串作为补充候选
    const cn = part.match(/[\u4e00-\u9fff\u3400-\u4dbf][\u4e00-\u9fff\u3400-\u4dbf0-9\s:：!！]+/g);
    if (cn) cn.forEach(m => addCandidate(m.trim()));
  }

  if (candidates.length === 0) {
    addCandidate(name.replace(noisePattern, ' ').replace(/\s+/g, ' ').trim());
  }

  const junkPattern = /^(豪华|解压即撸|预购特典|预购|特典|中文|汉化|破解|免安装|绿色|完整版|豪华版|终极|build[.\s]*\d+|\d+[\d.]*|v[\d.]+)$/i;
  const filtered = candidates.filter(c => !junkPattern.test(c.trim()));
  const finalCandidates = filtered.length > 0 ? filtered : candidates;

  const first = finalCandidates[0];
  const rest = finalCandidates.slice(1);
  // 优先英文（更易在 Steam 搜到），同语言时按长度降序
  rest.sort((a, b) => {
    const aIsEnglish = /^[A-Za-z]/.test(a);
    const bIsEnglish = /^[A-Za-z]/.test(b);
    if (aIsEnglish && !bIsEnglish) return -1;
    if (!aIsEnglish && bIsEnglish) return 1;
    return b.length - a.length;
  });

  return [first, ...rest].slice(0, 5);
}

// 清洗游戏名（取第一个候选）/ Clean a game name (first candidate)
export function cleanGameName(name) {
  const candidates = parseGameTitle(name);
  return candidates[0] || name || '';
}

// 选择注册表英文名：优先下载站标题中的英文段（与站点一致），
// 回退 Steam 官方英文名（可能为全大写形式）。
// Pick the registry EN name: the EN segment from the download-site title first,
// falling back to the Steam official EN name (may be ALL-CAPS).
export function pickRegistryEnName(gameName, steamEnName) {
  const enFromTitle = parseGameTitle(gameName || '').find(t => /^[A-Za-z]/.test(t));
  return enFromTitle || steamEnName || '';
}
