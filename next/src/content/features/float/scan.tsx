/**
 * game-radar v2 — 详情浮窗扫描器
 * Scanner: markers `<div data-gr-detail data-gr-title="…">` mount the Float;
 * declaration flow re-fetches detail and re-renders in place (idempotent).
 */
import { render } from 'preact';
import { send } from '../../../messaging/client.js';
import { Float } from './Float.jsx';
import type { DetailData } from '../../../steam/types.js';

function scanDetailMarkers(root: ParentNode): Array<{ el: HTMLElement; title: string }> {
  const out: Array<{ el: HTMLElement; title: string }> = [];
  for (const el of root.querySelectorAll<HTMLElement>('[data-gr-detail]')) {
    if (el.querySelector('.gr2-float-host')) continue;
    const title = el.getAttribute('data-gr-title')?.trim();
    if (title) out.push({ el, title });
  }
  return out;
}

function mountFloat(el: HTMLElement, title: string): void {
  const host = document.createElement('div');
  host.className = 'gr2-float-host';
  el.appendChild(host);

  const renderWith = (detail: DetailData) => {
    render(
      <Float
        detail={detail}
        onRetry={() => void refresh()}
        onDeclare={async (platformId) => {
          const resp = await send('platform/declare', { title, platformId });
          const fresh = await send('detail/get', { title });
          renderWith(fresh.detail); // 声明终态在位 → 重渲染平台视图
          return { metascore: resp.metascore, tag: resp.tag };
        }}
      />,
      host
    );
  };

  const refresh = async (): Promise<void> => {
    try {
      const resp = await send('detail/get', { title });
      renderWith(resp.detail);
    } catch {
      renderWith({ kind: 'failed', title, error: 'network' });
    }
  };

  void refresh();
}

/** 详情浮窗扫描（幂等） */
export function runFloatScan(): void {
  for (const marker of scanDetailMarkers(document)) {
    mountFloat(marker.el, marker.title);
  }
}
