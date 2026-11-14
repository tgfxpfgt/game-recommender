/**
 * game-radar v2 — fixture 评分提供方（确定性）
 * Deterministic fixture provider: same-interface as the future Steam provider.
 * 垂直切片用它端到端验证新栈；真源接入后此文件仅供 e2e 复用。
 */
import { normalizeTitleKey, titleSimilarity } from '../titles.js';
import type { RatingProvider, TitleResolution } from '../types.js';

interface FixtureEntry {
  appId: number;
  name: string;
  positiveRate: number | null;
  totalReviews: number;
  recent?: { rate: number; total: number };
}

/** 确定性数据表（键 = 规范化标题） */
const TABLE: Record<string, FixtureEntry> = {
  '艾尔登法环|elden ring': {
    appId: 1245620,
    name: 'Elden Ring',
    positiveRate: 94,
    totalReviews: 712340,
    recent: { rate: 92, total: 8210 }
  },
  '赛博朋克2077|cyberpunk 2077': {
    appId: 1091500,
    name: 'Cyberpunk 2077',
    positiveRate: 87,
    totalReviews: 688000,
    recent: { rate: 90, total: 12040 }
  },
  '星露谷物语|stardew valley': {
    appId: 413150,
    name: 'Stardew Valley',
    positiveRate: 98,
    totalReviews: 512000,
    recent: { rate: 97, total: 3300 }
  },
  '空洞骑士|hollow knight': {
    appId: 367520,
    name: 'Hollow Knight',
    positiveRate: 97,
    totalReviews: 421000,
    recent: { rate: 96, total: 2100 }
  },
  '双人成行|it takes two': {
    appId: 1426210,
    name: 'It Takes Two',
    positiveRate: 95,
    totalReviews: 289000,
    recent: { rate: 94, total: 1870 }
  },
  '巫师3|the witcher 3': {
    appId: 292030,
    name: 'The Witcher 3: Wild Hunt',
    positiveRate: 93,
    totalReviews: 655000,
    recent: { rate: 91, total: 4400 }
  }
};

/** 相似度门：≥0.6 confirmed，否则 suspected */
const CONFIRM_THRESHOLD = 0.6;

export const fixtureProvider: RatingProvider = {
  id: 'fixture',

  async resolve(titles: string[]): Promise<TitleResolution[]> {
    return titles.map((title) => {
      const key = normalizeTitleKey(title);
      const entry = TABLE[key] ?? matchByFuzzy(key);
      if (entry) {
        const similarity = titleSimilarity(entry.name, title);
        const resolution: TitleResolution = {
          kind: 'steam',
          title,
          appId: entry.appId,
          name: entry.name,
          positiveRate: entry.positiveRate,
          totalReviews: entry.totalReviews,
          recent: entry.recent ?? null,
          confidence: similarity >= CONFIRM_THRESHOLD ? 'confirmed' : 'suspected',
          reason: similarity >= CONFIRM_THRESHOLD ? '标题强匹配' : `弱匹配（相似度 ${similarity.toFixed(2)}）`
        };
        return resolution;
      }
      return { kind: 'not-found', title } as TitleResolution;
    });
  }
};

/** 模糊兜底：候选键互为包含（"巫师3 狂猎|the witcher 3" ↔ "巫师3"） */
function matchByFuzzy(key: string): FixtureEntry | null {
  for (const [k, entry] of Object.entries(TABLE)) {
    const ks = k.split('|');
    if (ks.some((seg) => key.includes(seg) || seg.includes(key))) return entry;
  }
  return null;
}
