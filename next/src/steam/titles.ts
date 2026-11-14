/**
 * game-radar v2 — 标题解析（搜索候选生成）
 * Title parsing: split site noise from the actual game name, produce ranked
 * search candidates. Fresh implementation — same observable behavior contract.
 */

/** 括号内容（版本/平台注记）与噪声段剔除后按分隔符拆分 */
export function parseTitleCandidates(rawTitle: string): string[] {
  const cleaned = rawTitle
    .replace(/《([^》]*)》/g, '$1') // 书名号保留内容
    .replace(/（[^）]*）/g, ' ') // 全角括号注记剔除
    .replace(/\([^)]*\)/g, ' '); // 半角括号注记剔除
  const segs = cleaned
    .split(/[|丨/／,，、;；:：\s\-—_·×•]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
  const noise = getNoiseSegments();
  const kept = segs.filter((s) => !noise.has(s.toLowerCase()));
  return rank(kept.length > 0 ? kept : segs);
}

/** 候选排序：英文名优先，其次长度降序（长名区分度高） */
function rank(segs: string[]): string[] {
  const isEn = (s: string) => /[A-Za-z]{3,}/.test(s);
  return [...new Set(segs)].sort((a, b) => {
    const ea = isEn(a) ? 0 : 1;
    const eb = isEn(b) ? 0 : 1;
    return ea - eb || b.length - a.length;
  });
}

/** 站点噪声段（下载站标题惯用非游戏词——小集合起步，错题库驱动增长） */
const NOISE = new Set([
  '下载',
  '免安装',
  '绿色版',
  '完整版',
  '官方中文',
  '中文',
  '汉化',
  '硬盘版',
  '学习版',
  '破解版',
  '集成',
  'dlc',
  '合集',
  '豪华版',
  '终极版',
  '年度版',
  '本体',
  '补丁',
  '升级档',
  '未加密',
  '修正',
  'vlxx',
  'repack'
]);
function getNoiseSegments(): Set<string> {
  return NOISE;
}

/** 规范化标题键（供缓存/fixture 匹配：去空白/全角转半角/小写） */
export function normalizeTitleKey(title: string): string {
  return title
    .replace(/\u3000/g, ' ')
    .replace(/[（(]/g, '(')
    .replace(/[）)]/g, ')')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** 标题相似度（归一化词 inclusion 判据——confirmed/suspected 门） */
export function titleSimilarity(resultName: string, rawTitle: string): number {
  const tokens = (s: string) =>
    s
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length >= 2);
  const rt = tokens(resultName);
  if (rt.length === 0) return 0;
  const tt = new Set(tokens(rawTitle));
  const hit = rt.filter((t) => tt.has(t)).length;
  return hit / rt.length;
}
