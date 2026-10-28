/**
 * 游戏雷达 Game Radar - 架构图生成脚本 / Architecture Diagram Generator
 *
 * v14.3.2：扫描代码库结构（文件/行数/import 边）→ 生成 docs/architecture.html
 * 的数据层（JSON），页面用 SVG 渲染架构图。接入 gate 的 release-smoke 步骤
 * 实现迭代时自动更新。
 * 用法: node scripts/generate-architecture.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'architecture-data.json');

// 扫描目录 → 模块节点
const MODULES = [
  {
    dir: 'background',
    label: 'Background (MV3 SW)',
    color: '#4a9eff',
    desc: 'Service Worker — 消息分发/检索管线/推荐引擎/存储'
  },
  { dir: 'content', label: 'Content Scripts', color: '#a3cf06', desc: '内容脚本 — 徽章注入/浮窗/行为采集' },
  { dir: 'options', label: 'Options', color: '#e74c3c', desc: '设置中心 — 全量配置/缓存管理/规则编辑' },
  { dir: 'dashboard', label: 'Dashboard', color: '#ff7b00', desc: '数据分析 — 统计/洞察/诊断/备份' },
  { dir: 'popup', label: 'Popup', color: '#b48ce0', desc: '弹出面板 — 快捷设置/快速搜索/状态' },
  { dir: 'sidepanel', label: 'SidePanel', color: '#67c1f5', desc: '侧边栏 — 当前页游戏/收藏/限免速览' },
  { dir: 'freegames', label: 'Free Games', color: '#e67e22', desc: '限免页 — Epic/GOG/Steam/GamerPower' },
  { dir: 'shared', label: 'Shared', color: '#95a5a6', desc: '跨侧共享 — msg/escape/settings-utils/fm-keys/spy-scales' },
  { dir: 'adapters', label: 'Adapters', color: '#2ecc71', desc: '站点适配器 — 规则/选择器/搜索 URL' },
  { dir: 'data', label: 'Data Layer', color: '#f39c12', desc: 'OPFS 持久化 — data-store/STORAGE_MODULES 注册表' }
];

function countLines(dir) {
  let files = 0,
    lines = 0;
  try {
    const items = fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true });
    for (const item of items) {
      const full = path.join(ROOT, dir, item.name);
      if (item.isDirectory()) {
        const sub = countLines(full);
        files += sub.files;
        lines += sub.lines;
      } else if (item.name.endsWith('.js') || item.name.endsWith('.css') || item.name.endsWith('.html')) {
        files++;
        lines += fs.readFileSync(full, 'utf-8').split('\n').length;
      }
    }
  } catch {
    /* ignore */
  }
  return { files, lines };
}

function extractVersion() {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf-8'));
    return manifest.version;
  } catch {
    return '?';
  }
}

const version = extractVersion();
const nodes = MODULES.map((m) => {
  const { files, lines } = countLines(m.dir);
  return { ...m, files, lines };
});

// 消息 action 数量
let actionCount = 0;
try {
  const contract = fs.readFileSync(path.join(ROOT, 'background/core/message-contract.js'), 'utf-8');
  actionCount = (contract.match(/^\s{2}[A-Z_]+:/gm) || []).length;
} catch {
  /* ignore */
}

// 存储模块数量
let storageCount = 0;
try {
  const registry = fs.readFileSync(path.join(ROOT, 'data/storage-registry.js'), 'utf-8');
  storageCount = (registry.match(/^\s{2}[A-Za-z_]+:\s*\{/gm) || []).length;
} catch {
  /* ignore */
}

// 测试统计
const testCount = 0;
let suiteCount = 0;
try {
  const vitestCfg = fs.readFileSync(path.join(ROOT, 'vitest.config.js'), 'utf-8');
  suiteCount = (vitestCfg.match(/tests\/(?:unit|integration)\/test-/g) || []).length;
} catch {
  /* ignore */
}

const data = {
  generatedAt: new Date().toISOString(),
  version,
  nodes,
  stats: { actionCount, storageCount, testCount, suiteCount },
  flows: [
    {
      from: 'Content Scripts',
      to: 'Background (MV3 SW)',
      label: 'SEARCH_STEAM / TRACK_EVENT / GET_* (~60 actions)',
      color: '#a3cf06'
    },
    { from: 'Background (MV3 SW)', to: 'Data Layer', label: 'OPFS read/write via data-store', color: '#f39c12' },
    {
      from: 'Background (MV3 SW)',
      to: 'Steam API',
      label: 'storesearch / appdetails / appreviews / SteamSpy',
      color: '#4a9eff'
    },
    { from: 'Background (MV3 SW)', to: 'Free Games', label: '限免推送通知', color: '#e67e22' },
    { from: 'Options', to: 'Background (MV3 SW)', label: 'GET_SETTINGS / SAVE_SETTINGS', color: '#e74c3c' },
    { from: 'Dashboard', to: 'Background (MV3 SW)', label: 'GET_STATS / GET_RUNTIME_METRICS', color: '#ff7b00' },
    { from: 'SidePanel', to: 'Background (MV3 SW)', label: 'GET_TAB_GAME / GET_FAVORITES', color: '#67c1f5' },
    {
      from: 'Popup',
      to: 'Background (MV3 SW)',
      label: 'GET_SETTINGS / SAVE_SETTINGS / GET_API_STATUS',
      color: '#b48ce0'
    }
  ]
};

fs.writeFileSync(OUT, JSON.stringify(data, null, 2));
console.log(`✅ 架构数据已生成: docs/architecture-data.json (${nodes.length} 模块, ${data.flows.length} 数据流)`);
