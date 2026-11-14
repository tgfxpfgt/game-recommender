/**
 * game-radar v2 — manifest 模板（typed 数据，非 JSON 手写）
 * The manifest is generated: content_scripts = one file per injection surface,
 * web_accessible_resources = zero (bundled iife needs no runtime URLs).
 */
export interface ChromeManifest {
  manifest_version: 3;
  name: string;
  version: string;
  default_locale: string;
  description: string;
  icons: Record<string, string>;
  background: { service_worker: string; type: 'module' };
  action: { default_popup: string; default_icon: Record<string, string> };
  content_scripts: Array<{ matches: string[]; js: string[]; css: string[]; run_at: 'document_start' }>;
  permissions: string[];
  host_permissions: string[];
  optional_host_permissions: string[];
}

/** 下载站域（功能等价：与旧版站点集一致；自定义站走 optional 权限） */
const TRACKED_MATCHES = [
  'http://*.xdgame.com/*',
  'https://*.xdgame.com/*',
  'http://*.xianyudanji.gg/*',
  'https://*.xianyudanji.gg/*',
  'http://*.gamer520.com/*',
  'https://*.gamer520.com/*',
  'http://*.gamers520.com/*',
  'https://*.gamers520.com/*',
  'http://*.3dmgame.com/*',
  'https://*.3dmgame.com/*',
  'http://*.ali213.net/*',
  'https://*.ali213.net/*',
  'http://*.gamersky.com/*',
  'https://*.gamersky.com/*'
];

export function buildManifest(version: string): ChromeManifest {
  return {
    manifest_version: 3,
    name: '__MSG_extName__',
    version,
    default_locale: 'zh_CN',
    description: '__MSG_extDesc__',
    icons: { 16: 'icons/icon16.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' },
    background: { service_worker: 'background/service-worker.js', type: 'module' },
    action: {
      default_popup: 'pages/popup/popup.html',
      default_icon: { 16: 'icons/icon16.png', 48: 'icons/icon48.png' }
    },
    content_scripts: [
      {
        matches: [...TRACKED_MATCHES, 'https://store.steampowered.com/*', 'https://*.steam250.com/*'],
        js: ['content/content.js'],
        css: ['content.css'],
        run_at: 'document_start'
      }
    ],
    permissions: ['storage', 'alarms', 'notifications', 'scripting', 'contextMenus', 'sidePanel'],
    host_permissions: [
      'https://store.steampowered.com/*',
      'https://api.steampowered.com/*',
      'https://steamspy.com/*',
      'https://www.metacritic.com/*',
      'https://cn.bing.com/*',
      'https://api.isthereanydeal.com/*',
      'https://www.gamerpower.com/*',
      'https://www.gog.com/*',
      'https://store-site-backend-official.ak.epicgames.com/*',
      'https://*.steam250.com/*'
    ],
    optional_host_permissions: ['http://*/*', 'https://*/*']
  };
}
