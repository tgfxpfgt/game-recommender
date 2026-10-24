import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * 游戏雷达 Game Radar - E2E 冒烟共享 harness / E2E smoke shared harness
 *
 * 第五轮 B9 自 e2e-smoke.mjs 拆出：E2E_MOCK/RECORD 网络录制回放、fixture 页
 * 生成与本地 HTTP 托管、浏览器启动参数、check 计数器工厂。分节模块见同目录
 * section-*.mjs，执行管线见 run.mjs（E2E_MOCK 双模式语义不动）。
 * Split from e2e-smoke.mjs: network record/replay, fixture page + local HTTP
 * server, launch args and the check-counter factory. Sections: section-*.mjs.
 */
('use strict');

const SECTION_DIR = path.dirname(fileURLToPath(import.meta.url)); // tests/e2e/
export const TESTS_DIR = path.resolve(SECTION_DIR, '..'); // tests/
export const EXTENSION_DIR = path.resolve(TESTS_DIR, '..'); // 项目根（manifest 所在）
export const FIXTURE = path.join(TESTS_DIR, 'fixtures', 'list-page.html');
export const USER_DATA_DIR = path.join(TESTS_DIR, '.e2e-profile');

// v7.3.0：E2E 网络 mock（录制/回放）——真实 Steam 段离线可跑。
// E2E_RECORD=1：透传真实请求并保存响应为 fixture；E2E_MOCK=1：只回放 fixture
//（未命中返回 404，让断言可见失败）。CI 用 E2E_MOCK=1 跑全量，不再依赖
// 外部网络可用性（此前 E2E_FAST 只能跳过真实网络段）。
export const MOCK = process.env.E2E_MOCK === '1';
export const RECORD = process.env.E2E_RECORD === '1';
export const FAST = process.env.E2E_FAST === '1';
const FIXTURES_DIR = path.join(TESTS_DIR, 'fixtures', 'http');
// mock 后台检索 API（storesearch/appdetails/appreviews/steamspy）+ 限免源
//（v9.3.0：Epic/GOG/GamerPower——限免链路离线可测）。
// v14.5.1：图片域入 MOCK（原"图片直通"使 MOCK 依赖 Steam CDN 真实网络——
// CDN 抖动时页面图片资源报 net::ERR 打红 console-error 断言，MOCK 的离线
// 确定性契约被破坏）；图片请求在 routeHandler 统一回 1×1 透明 GIF。
export const MOCK_RE =
  /^https?:\/\/(store\.steampowered\.com|api\.steampowered\.com|steamspy\.com)\/api\/|^https?:\/\/(store-site-backend-official\.ak\.epicgames\.com|gog\.com|gamerpower\.com)\/|^https?:\/\/(shared\.akamai\.steamstatic\.com|cdn\.akamai\.steamstatic\.com|cdn\.cloudflare\.steamstatic\.com|media\.steampowered\.com|shared\.cloudflare\.steamstatic\.com)\//;

// fixture 文件名：host + pathname（转下划线）+ 规范化 query（排序后截断）
function fixtureKey(urlStr) {
  const u = new URL(urlStr);
  const pairs = [...u.searchParams].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const qs = new URLSearchParams(pairs).toString();
  const pathPart = (u.pathname.replace(/[^a-zA-Z0-9]/g, '_') || 'root').slice(0, 120);
  const qPart = qs ? '__' + qs.replace(/[^a-zA-Z0-9=._-]/g, '_').slice(0, 80) : '';
  return path.join(u.host, pathPart + qPart + '.json');
}

export async function routeHandler(route) {
  const req = route.request();
  // v14.5.1：MOCK 模式图片请求统一回 1×1 透明 GIF（离线确定性——DOM 中
  // <img> 元素本身即测试所需，字节内容无断言依赖；避免 CDN 抖动报
  // net::ERR 打红 console-error 断言）
  if (MOCK && req.resourceType() === 'image') {
    await route.fulfill({
      status: 200,
      contentType: 'image/gif',
      body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
    });
    return;
  }
  const file = path.join(FIXTURES_DIR, fixtureKey(req.url()));
  if (MOCK) {
    // 回放：命中 fixture 原样返回；未命中 404（断言可见失败，不静默）
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      await route.fulfill({
        status: data.status,
        contentType: data.contentType || 'application/json',
        body: data.body
      });
    } catch {
      console.warn('  ⚠️ fixture 未命中:', req.url());
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    }
    return;
  }
  if (RECORD) {
    try {
      const resp = await route.fetch();
      const body = await resp.text();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        JSON.stringify({
          status: resp.status(),
          contentType: resp.headers()['content-type'] || 'application/json',
          body
        })
      );
      await route.fulfill({
        status: resp.status(),
        contentType: resp.headers()['content-type'] || 'application/json',
        body
      });
    } catch (e) {
      console.warn('  ⚠️ 录制失败（上游不可达）:', req.url(), String(e).slice(0, 80));
      await route.abort();
    }
    return;
  }
  await route.continue(); // 非 mock/record：直通真实网络
}

// 生成 fixture 页（模拟 xianyudanji 列表页/详情页结构）；用本地 http 托管
// （file:// 不被内容脚本 <all_urls> 匹配）。详情页 h1 复刻 16598 标题场景。
// v4.1.0：count 参数支持大列表（滚动批次场景，130 项 > 首屏批 60）
export function makeListHtml(count = 3) {
  const items = Array.from(
    { length: count },
    (_, i) => `<li class="game-item"><a class="tit" href="/${100 + i}.html">游戏${i + 1}</a></li>`
  ).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>fixture</title></head>
<body><h2 class="entry-title"><a href="/1.html">游戏A</a></h2>
<ul id="game-list">${items}</ul></body></html>`;
}
export const LIST_HTML = makeListHtml();
// 详情页：主内容区（article 内含主图 Steam CDN 1213700）+ 侧边推荐图（2001760）——
// 验证 appId 提取限定主内容区 + 后台名称相关性校验（v3.3.14）
export const DETAIL_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>北方之魂增强版/Spirit of the North- Switch520.com</title></head>
<body>
<article class="entry-content">
  <h1 class="entry-title">北方之魂增强版/Spirit of the North- Switch520.com</h1>
  <img src="https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1213700/header.jpg">
</article>
<aside class="sidebar">
  <a href="/119428.html"><img src="https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2001760/header.jpg"></a>轮回之兽|修改器
</aside>
</body></html>`;

// 写入 fixture 并启动本地 HTTP 服务（v14 B9 提取；返回各页面 URL）
export async function startFixtureServer() {
  fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
  fs.writeFileSync(FIXTURE, LIST_HTML);
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.url.includes('16598')) return res.end(DETAIL_HTML);
    if (req.url.includes('scroll=1')) return res.end(makeListHtml(130)); // v4.1.0 滚动批次
    res.end(LIST_HTML);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  // 用 host-resolver-rules 把下载站域名映射到本地 fixture（内容脚本对非追踪
  // 站点会早退，域名必须是已追踪的下载站）
  const port = server.address().port;
  // v10.5.3 起根路径被识别为站点首页（列表功能暂停防首页错位）——E2E 列表页
  // 固定带查询串（首页门控放行带查询串的根路径）；详情/滚动页单独构造
  return {
    server,
    FIXTURE_URL: `http://www.xianyudanji.gg:${port}/?e2e=1`,
    FIXTURE_ROOT: `http://www.xianyudanji.gg:${port}/`
  };
}

// v9.1.0：默认 bundled Chromium（E2E_CHANNEL 可覆盖；复用系统浏览器免下载）
const channel = process.env.E2E_CHANNEL || 'chromium';
export function launchOpts() {
  return {
    channel,
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`,
      `--host-resolver-rules=MAP www.xianyudanji.gg 127.0.0.1`
    ]
  };
}

// check 计数器工厂（v14 B9：pass/fail 归 runner 所有，经 state.check 下发）
export function createChecks() {
  let pass = 0,
    fail = 0;
  return {
    check(name, ok, extra = '') {
      if (ok) {
        pass++;
        console.log('  ✅', name);
      } else {
        fail++;
        console.log('  ❌', name, extra);
      }
    },
    summary() {
      return { pass, fail };
    }
  };
}
