/**
 * game-radar v2 — zh-CN 文案字典（typed）
 * All user-visible strings live here; code references t('badge.steamHit').
 * 旧世界 25,600 处散落 CJK 串的新世界形态：编译期键检查 + 单点替换。
 */
export const zhCN = {
  badge: {
    steamHit: '{rate}% 好评 · {total} 评测',
    noReviews: '暂无整体评价',
    suspected: '推测',
    confirmedReason: '标题强匹配',
    platformConsole: '主机平台游戏（Metacritic 优先）',
    platformEmulator: '模拟器/ROM 条目（不检索评分）',
    metascore: 'MC {score}',
    metascoreMissing: 'MC —',
    notFound: '未找到',
    failedNetwork: '网络异常·点击重查'
  },
  popup: {
    title: '游戏雷达 Game Radar',
    provider: '数据提供方',
    resolved: '已解析条目',
    cacheHits: '缓存命中'
  }
} as const;

/** 文案键路径类型（t() 的键约束） */
export type LocaleKey = {
  [K in keyof typeof zhCN]: keyof (typeof zhCN)[K] extends never
    ? never
    : `${string & K}.${string & keyof (typeof zhCN)[K]}`;
}[keyof typeof zhCN];

const FLAT: Record<string, string> = (() => {
  const flat: Record<string, string> = {};
  for (const [domain, entries] of Object.entries(zhCN)) {
    for (const [key, text] of Object.entries(entries as Record<string, string>)) {
      flat[`${domain}.${key}`] = text;
    }
  }
  return flat;
})();

/** 取文案（{var} 插值） */
export function t(key: LocaleKey, vars: Record<string, string | number> = {}): string {
  const text = FLAT[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
}
