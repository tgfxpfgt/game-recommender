/**
 * game-radar v2 — 内容脚本入口
 * Content entry: inject theme vars once, then run the badge scan on idle.
 * 打包模式：单 iife 文件，manifest content_scripts 一条引用——旧世界
 * 7 文件注入序列 + module-manifest 双清单 + getURL 动态装载在新形态下消失。
 */
import { themeCss } from '../ui/tokens.js';
import { runBadgeScan } from './features/badges/scan.js';

function injectTheme(): void {
  const style = document.createElement('style');
  style.id = 'gr2-theme';
  style.textContent = themeCss();
  (document.head || document.documentElement).appendChild(style);
}

function start(): void {
  injectTheme();
  const run = () => void runBadgeScan();
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(run, 0);
  } else {
    window.addEventListener('DOMContentLoaded', run, { once: true });
  }
}

start();
