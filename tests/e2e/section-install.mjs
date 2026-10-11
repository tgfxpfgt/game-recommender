/**
 * 游戏雷达 Game Radar - E2E 冒烟：安装/欢迎页 / E2E smoke: install & welcome
 *
 * 第五轮 B9 自 e2e-smoke.mjs 拆出（v7.4.0 首次安装 onInstalled 自动打开欢迎页
 * + v14.2.0 分步引导假绿修复 + v8.2.0 update 模式 What's new）。
 * state: { context, extId, check } — 由 run.mjs 注入。
 */
('use strict');

export async function runInstall(state) {
  const { context, extId, check } = state;

  // v7.4.0：首次安装 onInstalled 自动打开欢迎页（install → 功能导览）
  console.log('1b. 欢迎页（首次安装自动打开）');
  let welcomeTab = context.pages().find((p) => p.url().includes('welcome/welcome.html'));
  for (let i = 0; i < 10 && !welcomeTab; i++) {
    await new Promise((r) => setTimeout(r, 500));
    welcomeTab = context.pages().find((p) => p.url().includes('welcome/welcome.html'));
  }
  if (welcomeTab) {
    await welcomeTab.waitForTimeout(600);
    // v14.2.0（复审轮 P1-1 假绿修复）：v14.1.0 起 install 模式默认展示分步引导
    // （feature-card 所在 installSection 被 hidden）——querySelectorAll 不受
    // display:none 影响导致旧断言恒真。改为断言"引导可见 + 4 步点完跳 dashboard"。
    const wState = await welcomeTab.evaluate(() => ({
      guideVisible:
        !!document.getElementById('guideStep1') && document.getElementById('guideStep1').offsetParent !== null,
      dots: document.querySelectorAll('#guideDots .dot').length,
      hasHub: !!document.getElementById('openHubBtn')
    }));
    check('欢迎页分步引导渲染（安装模式，v14.2 假绿修复）', wState.guideVisible && wState.dots === 4 && wState.hasHub);
    // 引导 4 步走完 → 跳转 dashboard（v14.1.0 头号新功能的端到端验证）
    for (let i = 0; i < 4; i++) {
      if (welcomeTab.url().includes('dashboard')) break;
      const next = await welcomeTab.$('#guideNext');
      if (!next) break;
      await next.click();
      await welcomeTab.waitForTimeout(500);
    }
    check('欢迎页引导完成跳转 dashboard', welcomeTab.url().includes('dashboard/dashboard.html'));
  } else {
    check('欢迎页已打开（install 模式）', false);
  }
  // v8.2.0：update 模式（What's new）——直接访问 ?source=update 验证渲染
  const updWelcome = await context.newPage();
  await updWelcome.goto(`chrome-extension://${extId}/welcome/welcome.html?source=update`);
  await updWelcome.waitForTimeout(500);
  const updState = await updWelcome.evaluate(() => ({
    changelog: document.querySelectorAll('.changelog li').length,
    installHidden: document.getElementById('installSection').classList.contains('hidden')
  }));
  check("欢迎页更新模式（What's new 渲染 + 安装区隐藏）", updState.changelog >= 5 && updState.installHidden);
  await updWelcome.close();
}
