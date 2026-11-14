/**
 * game-radar v2 — 列表徽章扫描器
 * Scanner: find titled entries, resolve via pipeline, render Badge components.
 * 扫描约定（站点适配器 v2 格式）：容器 [data-gr-entry]，标题 [data-gr-title]。
 * 真实站点适配批次将把 6 站选择器收敛为同构 typed 数据。
 */
import { render } from 'preact';
import { send } from '../../../messaging/client.js';
import { Badge } from './Badge.jsx';
import type { TitleResolution } from '../../../steam/types.js';

interface Entry {
  el: HTMLElement;
  titleEl: Element;
  title: string;
}

function scanEntries(root: ParentNode): Entry[] {
  const out: Entry[] = [];
  for (const el of root.querySelectorAll<HTMLElement>('[data-gr-entry]')) {
    if (el.querySelector('.gr2-badge-host')) continue; // 幂等：已挂载跳过
    const titleEl = el.querySelector('[data-gr-title]');
    const title = titleEl?.getAttribute('data-gr-title')?.trim();
    if (titleEl && title) out.push({ el, titleEl, title });
  }
  return out;
}

function mountBadge(entry: Entry, resolution: TitleResolution, onRetry: () => void): void {
  const host = document.createElement('span');
  host.className = 'gr2-badge-host';
  entry.titleEl.parentElement?.insertBefore(host, entry.titleEl);
  render(<Badge resolution={resolution} onRetry={onRetry} />, host);
}

/** 扫描 + 解析 + 渲染（幂等，可重复触发） */
export async function runBadgeScan(): Promise<void> {
  const entries = scanEntries(document);
  if (entries.length === 0) return;
  const titles = [...new Set(entries.map((e) => e.title))];
  let results: Record<string, TitleResolution> = {};
  try {
    const resp = await send('badges/resolve', { titles });
    results = resp.results;
  } catch {
    // 网络层失败：全部条目渲染失败态（点击重查——三态语义的"失败未知"）
    for (const t of titles) results[t] = { kind: 'failed', title: t, error: 'network' };
  }
  for (const entry of entries) {
    const r = results[entry.title];
    if (!r) continue;
    mountBadge(entry, r, () => {
      void (async () => {
        const resp = await send('badges/resolve', { titles: [entry.title] }).catch(() => null);
        const fresh = resp?.results[entry.title];
        if (fresh) mountBadge(entry, fresh, () => {});
      })();
    });
  }
}
