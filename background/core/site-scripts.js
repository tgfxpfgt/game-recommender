/**
 * 游戏雷达 Game Radar - 自定义站点内容脚本动态注册 / Dynamic Site Scripts
 *
 * v7.4.0：content_scripts 注入范围按"网站"匹配——manifest 只静态注入内置
 * 站点与 Steam；用户自定义/导入的适配规则站点经本模块 registerContentScripts
 * 动态注册（MV3 持久化，浏览器重启后保留）。这样扩展绝不注入无关网站
 * （性能 + 隐私观感），同时保留自定义站点的完整能力。
 *
 * 幂等策略：SW 启动与适配规则保存后调用 syncSiteScripts()——遍历规则 domains，
 * 对不在内置清单（manifest 已静态注入，无需注册）的域名补齐注册；已注册的
 * 跳过（getRegisteredContentScripts 比对 id）。移除站点不做 unregister——
 * tracker 按规则早退兜底（不再追踪的站点零工作）。
 */
import { getSiteRules, isValidSiteDomain } from './rules.js';

// 注：core 层不依赖 storage（分层约束）——日志用 console（SW 可见）

// 内置站点域名（与 manifest content_scripts matches 同步——test-integrity
// 有一致性断言防漂移；新增内置站点须同时更新本清单与 manifest）
// Built-in site domains (mirrors manifest content_scripts matches; the
// integrity suite asserts both stay in sync).
export const BUILTIN_DOMAINS = [
  'xdgame.com',
  'xianyudanji.gg',
  'gamer520.com',
  '3dmgame.com',
  'ali213.net',
  'gamersky.com'
];

// 与 manifest content_scripts 相同的注入清单（动态注册用）
const SITE_SCRIPT_FILES = [
  'shared/patterns.js',
  'shared/msg.js',
  'shared/escape.js',
  'adapters/default.js',
  'adapters/sites/xdgame.js',
  'adapters/sites/xianyudanji.js',
  'adapters/sites/gamer520.js',
  'adapters/sites/3dmgame.js',
  'adapters/sites/ali213.js',
  'adapters/sites/gamersky.js',
  'adapters/index.js',
  'content/tracker.js'
];

const scriptId = (domain) => `gr-site-${domain.replace(/[^a-z0-9.-]/gi, '_')}`;

/** @type {Promise<void>|null} */
let syncing = null;

// 同步自定义站点注册（幂等；规则变化后重跑补齐新站点）
// Idempotent sync: register content scripts for rule domains outside the
// built-in list (which the manifest already injects statically).
export async function syncSiteScripts() {
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      if (!chrome.scripting || !chrome.scripting.registerContentScripts) return;
      const rules = /** @type {{ sites?: Array<{ domains?: string[] }> }} */ ((await getSiteRules()) || { sites: [] });
      const customDomains = (rules.sites || [])
        .flatMap((s) => s.domains || [])
        // v10.5.0 P0-C：纵深防御——即便历史/导入规则绕过保存校验，含通配/协议/
        // 路径的非法主机名也绝不进入 registerContentScripts 匹配模式
        // Defense-in-depth: reject any non-hostname domain before it becomes a
        // chrome.scripting match pattern, independent of save-time validation.
        .filter((d) => isValidSiteDomain(d) && !BUILTIN_DOMAINS.includes(d));
      if (customDomains.length === 0) return;
      const registered = await chrome.scripting.getRegisteredContentScripts().catch(() => []);
      const registeredIds = new Set((registered || []).map((s) => s.id));
      const toRegister = customDomains
        .filter((d) => !registeredIds.has(scriptId(d)))
        .map((d) => ({
          id: scriptId(d),
          matches: [`*://${d}/*`, `*://*.${d}/*`],
          js: SITE_SCRIPT_FILES,
          css: ['styles/content.css'],
          runAt: 'document_start',
          allFrames: false
        }));
      if (toRegister.length === 0) return;
      await chrome.scripting.registerContentScripts(toRegister);
      console.log(`【游戏雷达】 动态注册自定义站点内容脚本: ${toRegister.map((s) => s.id).join(', ')}`);
    } catch (e) {
      console.warn('【游戏雷达】 自定义站点脚本注册失败:', String(e));
    }
  })();
  try {
    await syncing;
  } finally {
    syncing = null;
  }
}
