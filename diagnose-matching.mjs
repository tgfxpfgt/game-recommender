/**
 * 匹配回归诊断脚本（一次性运维工具）
 * 用法：node diagnose-matching.mjs
 */
import { createStorageMock, installChromeStorageMock } from './tests/helpers/storage-mock.mjs';
installChromeStorageMock(createStorageMock());
globalThis.chrome = {
  runtime: { getURL: (p) => p },
  storage: { local: { get: async () => ({}), set: async () => {} }, session: { get: async () => ({}), set: async () => {} } },
  notifications: { create: async () => {} },
  action: { setBadgeText() {}, setBadgeBackgroundColor() {} }
};
globalThis.window = globalThis;

const TESTS = [
  { cn: '奇迹时代4', en: 'Age of Wonders 4 Premium Edition', appId: '1669000' },
  { cn: '战争机器：事变日', en: 'Gears of War: E-Day', appId: '3010850' },
  { cn: '龙与地下城：无冬之夜2增强版', en: 'Dungeons & Dragons Neverwinter Nights 2: Enhanced Edition', appId: '2738630' },
  { cn: '艾尔登法环', en: 'Elden Ring', appId: '1245620' },
  { cn: '赛博朋克2077', en: 'Cyberpunk 2077', appId: '1091500' }
];

// 每游戏独立进程（避免模块级缓存/名称索引/注册表状态串扰）
const isChild = process.argv[2];
if (isChild) {
  // 子进程模式：匹配单游戏
  const idx = Number(isChild);
  const t = TESTS[idx];
  const rawTitle = t.cn + '|' + t.en;
  const { handleSearchSteam } = await import('./background/handlers/steam.js');
  const r = await handleSearchSteam({ gameName: t.cn, rawTitle }, { tab: { id: 1, url: 'https://test' } });
  const got = r && r.data ? String(r.data.appId) : 'null';
  const ok = got === t.appId ? '✓' : '✗';
  console.log(`${ok} ${t.cn} → ${got} ${r && r.data ? r.data.name : '(null)'} (expect ${t.appId})`);
  process.exit(0);
}

// 父进程模式：逐个 spawn 子进程
import { execSync } from 'node:child_process';
let pass = 0;
for (let i = 0; i < TESTS.length; i++) {
  const t = TESTS[i];
  try {
    const out = execSync(`node --input-type=module -e "
      process.argv[2] = '${i}';
      await import('./diagnose-matching.mjs');
    "`, { encoding: 'utf-8', timeout: 60000, cwd: process.cwd() });
    console.log(out.trim());
    if (out.includes('✓')) pass++;
  } catch (e) {
    console.log(`✗ ${t.cn}: ${String(e.stdout || e).slice(0, 120)}`);
  }
}
console.log(`\\n${pass}/${TESTS.length} passed`);
