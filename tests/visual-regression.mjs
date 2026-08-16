/**
 * 游戏雷达 Game Radar - UI 视觉回归 / Visual Regression
 *
 * v7.3.0：对四个扩展页（popup/options/dashboard/freegames）截图并与基线
 * pixelmatch 对比——UI 布局/样式回归（如面板逃逸、样式丢失）可被直接抓到。
 * 基线存 tests/visual/baseline/（提交入库）；差异输出 tests/visual/diff/。
 * Run: npm run visual            （对比基线，超过阈值非零退出）
 *       npm run visual -- --update（重新生成基线——版本号/主题变更后使用）
 * 注意：基线含版本号文本（popup/hub 显示 vX.Y.Z）——每次发版需 --update 更新。
 */
import { chromium } from 'playwright-core';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_DIR = path.resolve(ROOT, '..');
const BASELINE_DIR = path.join(ROOT, 'visual', 'baseline');
const DIFF_DIR = path.join(ROOT, 'visual', 'diff');
// 超过 0.5% 像素差异视为回归（抗字体抗锯齿/亚像素抖动）
const MAX_DIFF_RATIO = 0.005;

const UPDATE = process.argv.includes('--update');
// v9.1.0：默认 bundled Chromium（Chrome for Testing）；E2E_CHANNEL=chrome 用系统 Chrome
const CHANNEL = process.env.E2E_CHANNEL || 'chromium';
const userDataDir = path.join(ROOT, '.visual-profile');

const PAGES = [
  // v8.2.0：多主题基线；v9.2.0：代表主题（深色工业/浅色扁平/终端/莫兰迪）
  // 覆盖皮肤系统浅色分支；popup/dashboard 保持默认主题
  // v9.1.0：交互态基线——popup 全部分组展开 / options 过滤面板
  {
    name: 'popup',
    url: 'popup/popup.html',
    viewport: { width: 420, height: 620 },
    themes: ['steam'],
    states: [
      {
        name: 'expanded',
        prep: async (page) => {
          await page.evaluate(() => document.querySelectorAll('details.popup-section').forEach((d) => (d.open = true)));
          await page.waitForTimeout(300);
        }
      }
    ]
  },
  {
    name: 'options',
    url: 'options/options.html',
    viewport: { width: 1280, height: 800 },
    themes: ['steam', 'ios17', 'cyberpunk', 'morandi'],
    states: [
      {
        name: 'filters',
        prep: async (page) => {
          await page.evaluate(() => document.querySelector('.gr-nav-item[data-panel="filters"]').click());
          await page.waitForTimeout(400);
        }
      }
    ]
  },
  { name: 'dashboard', url: 'dashboard/dashboard.html', viewport: { width: 1280, height: 800 }, themes: ['steam'] }
  // 注：freegames 页为动态限免数据（每次运行内容漂移），不适合像素基线对比
];

let pass = 0,
  fail = 0;
function report(name, ok, extra = '') {
  if (ok) {
    pass++;
    console.log('  ✅', name);
  } else {
    fail++;
    console.log('  ❌', name, extra);
  }
}

fs.rmSync(userDataDir, { recursive: true, force: true });
fs.mkdirSync(BASELINE_DIR, { recursive: true });
fs.mkdirSync(DIFF_DIR, { recursive: true });

const context = await chromium.launchPersistentContext(userDataDir, {
  channel: CHANNEL,
  headless: false,
  args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`]
});
try {
  // 获取扩展 id（service worker 就绪）
  let extId = null;
  for (let i = 0; i < 30 && !extId; i++) {
    const workers = context.serviceWorkers();
    if (workers.length > 0) extId = new URL(workers[0].url()).host;
    else await new Promise((r) => setTimeout(r, 500));
  }
  if (!extId) {
    console.error('❌ 扩展未加载');
    process.exit(1);
  }
  console.log(
    `视觉回归：扩展 v${JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, 'manifest.json'), 'utf-8')).version}`
  );

  for (const p of PAGES) {
    const page = await context.newPage();
    await page.setViewportSize(p.viewport);
    await page.goto(`chrome-extension://${extId}/${p.url}`);
    // 等待渲染稳定（options/dashboard 有异步数据加载）
    await page.waitForTimeout(1500);
    // 默认态 + 交互态（v9.1.0：states 为附加基线）
    const states = [{ name: null, prep: null }, ...(p.states || [])];
    for (const theme of p.themes) {
      // 直接设置 data-theme（themes.css 按 body[data-theme] 生效）
      await page.evaluate((t) => document.body.setAttribute('data-theme', t), theme);
      await page.waitForTimeout(300);
      for (const st of states) {
        if (st.prep) await st.prep(page);
        // 截首屏（固定 viewport 尺寸——fullPage 高度随动态内容漂移，无法稳定对比；
        // 布局回归在首屏即可见）
        const shot = await page.screenshot();
        const base = st.name ? `${theme}-${p.name}-${st.name}` : `${theme}-${p.name}`;
        const file = path.join(BASELINE_DIR, base + '.png');
        if (UPDATE) {
          fs.writeFileSync(file, shot);
          report(`${base} 基线已更新`, true);
        } else {
          if (!fs.existsSync(file)) {
            report(`${base} 缺少基线（先跑 npm run visual -- --update）`, false);
            continue;
          }
          const baseImg = PNG.sync.read(fs.readFileSync(file));
          const now = PNG.sync.read(shot);
          const diff = new PNG({ width: baseImg.width, height: baseImg.height });
          const mismatched = pixelmatch(baseImg.data, now.data, diff.data, baseImg.width, baseImg.height, {
            threshold: 0.15
          });
          const ratio = mismatched / (baseImg.width * baseImg.height);
          if (ratio > MAX_DIFF_RATIO) {
            fs.writeFileSync(path.join(DIFF_DIR, base + '.png'), PNG.sync.write(diff));
            report(`${base} 与基线差异 ${(ratio * 100).toFixed(2)}%`, false, `(diff: tests/visual/diff/${base}.png)`);
          } else {
            report(`${base} 与基线一致（差异 ${(ratio * 100).toFixed(3)}%）`, true);
          }
        }
      }
    }
    await page.close();
  }
} finally {
  await context.close().catch(() => {});
  fs.rmSync(userDataDir, { recursive: true, force: true });
}

console.log(`\n===== 视觉回归结果 =====\n${pass} 通过, ${fail} 失败${UPDATE ? '（基线更新模式）' : ''}`);
process.exit(fail > 0 ? 1 : 0);
