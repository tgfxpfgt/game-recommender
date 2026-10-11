/**
 * 游戏雷达 Game Radar - E2E 冒烟：自定义站点动态注册 / E2E smoke: custom site
 *
 * 第五轮 B9 自 e2e-smoke.mjs 拆出（v7.4.0 网站范围注入——自定义站点
 * registerContentScripts）。放最后：保存自定义规则会临时覆盖内置规则
 *（随后删除恢复）。注册域名须有 host permission——用 manifest 已含的 localhost。
 * state: { context, extId, check } — 由 run.mjs 注入（重启后新实例）。
 */
('use strict');

export async function runCustomSite(state) {
  const { context, extId, check } = state;

  // 7. 自定义站点内容脚本动态注册（v7.4.0：网站范围注入——自定义站点 registerContentScripts）
  console.log('7. 自定义站点内容脚本动态注册');
  const regPage = await context.newPage();
  await regPage.goto(`chrome-extension://${extId}/popup/popup.html`);
  await regPage.waitForTimeout(500);
  await regPage.evaluate(async () => {
    await chrome.runtime.sendMessage({
      action: 'SAVE_ADAPTER_RULES',
      rules: {
        version: 1,
        sites: [
          {
            key: 'grtest',
            name: 'GR Test',
            domains: ['localhost'],
            listItem: { containers: ['li'], titleEls: ['a'], minLen: 2 }
          }
        ]
      }
    });
  });
  await regPage.waitForTimeout(1500);
  const regIds = await regPage.evaluate(async () => {
    const scripts = await chrome.scripting.getRegisteredContentScripts();
    return scripts.map((s) => s.id);
  });
  check('自定义站点脚本已注册（gr-site-localhost）', regIds.includes('gr-site-localhost'));
  // 恢复内置规则（删除自定义规则 → 内置回退）
  await regPage.evaluate(async () => {
    await chrome.runtime.sendMessage({ action: 'DELETE_ADAPTER_RULES' });
  });
  await regPage.waitForTimeout(800);
  await regPage.close();
}
