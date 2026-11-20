// v15 阶段 3 全量迁移：preact 同步垫片源（build.mjs esbuild bundle 为
// shared/preact-globals.js iife —— classic 页面脚本经 window.__GR_PREACT__
// 同步取 h/render，免除 per-page 动态 import 的异步挂载）。
// Preact sync shim source; bundled to an iife exposing window.__GR_PREACT__.
import { h, render, Fragment } from 'preact';

globalThis.__GR_PREACT__ = { h, render, Fragment };
