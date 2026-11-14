// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { render } from 'preact';
import { Float } from './Float.jsx';
import type { DetailData } from '../../../steam/types.js';

function mount(detail: DetailData): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(<Float detail={detail} onDeclare={async () => ({ metascore: 85, tag: 'Switch' })} onRetry={() => {}} />, host);
  return host;
}

const steamDetail: DetailData = {
  kind: 'steam',
  title: '艾尔登法环|Elden Ring',
  appId: 1245620,
  name: 'Elden Ring',
  headerImage: '',
  positiveRate: 94,
  totalReviews: 712340,
  recent: { rate: 92, total: 8210 },
  confidence: 'confirmed',
  reason: '标题强匹配',
  description: 'fixture 确定性详情。',
  releaseDate: '2026-01-01',
  reviews: [{ recommended: true, content: '好评样例', date: '2026-11-01' }]
};

describe('Float（详情浮窗三态渲染）', () => {
  it('steam 命中：好评率/近期/评测/AppID 齐备', () => {
    const host = mount(steamDetail);
    expect(host.textContent).toContain('94%');
    expect(host.textContent).toContain('近 30 天：92%');
    expect(host.textContent).toContain('好评样例');
    expect(host.textContent).toContain('AppID 1245620');
    expect(host.querySelector('a[href*="store.steampowered.com"]')).toBeTruthy();
  });

  it('platform：MC chip + 声明栏（机型 select/按钮 id 契约）', () => {
    const host = mount({
      kind: 'platform',
      title: '塞尔达传说|Switch',
      platform: 'console',
      tag: '主机',
      metascore: null,
      mcName: null,
      source: 'detected'
    });
    expect(host.textContent).toContain('MC —');
    expect(host.querySelector('#gr2-declare-select')).toBeTruthy();
    expect(host.querySelector('#gr2-declare-btn')).toBeTruthy();
    const opt = host.querySelector('#gr2-declare-select option[value="switch"]');
    expect(opt?.textContent).toEqual('Switch');
  });

  it('not-found：声明栏在位（手动机型声明入口）', () => {
    const host = mount({ kind: 'not-found', title: '未知游戏' });
    expect(host.textContent).toContain('未找到');
    expect(host.querySelector('#gr2-declare-btn')).toBeTruthy();
  });

  it('failed：重试按钮 + 失败未知语义（非「未找到」）', () => {
    const host = mount({ kind: 'failed', title: 'X', error: 'network' });
    expect(host.textContent).not.toContain('确认 Steam 无此游戏'); // failed ≠ not-found：解释文案可含字样，但不得渲染确认无值语义
    expect(host.textContent).toContain('失败未知');
    expect(host.querySelector('button')).toBeTruthy();
  });
});
