/**
 * game-radar v2 — Popup 页（Preact 函数组件）
 * Popup: live pipeline stats over the typed messaging channel.
 */
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { send } from '../../messaging/client.js';
import { t } from '../../locales/zh-CN.js';

interface Stats {
  resolved: number;
  cacheHits: number;
  provider: string;
}

export function Popup(): h.JSX.Element {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    send('stats/get', {})
      .then((r) => setStats(r.stats))
      .catch(() => setStats({ resolved: 0, cacheHits: 0, provider: 'unreachable' }));
  }, []);

  return (
    <div className="gr2" style={{ padding: '12px', minWidth: '240px', color: 'var(--gr-text-primary)' }}>
      <h1 style={{ fontSize: '14px', margin: '0 0 8px' }}>{t('popup.title')}</h1>
      <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
        <tbody>
          <Row label={t('popup.provider')} value={stats?.provider ?? '…'} />
          <Row label={t('popup.resolved')} value={String(stats?.resolved ?? '…')} />
          <Row label={t('popup.cacheHits')} value={String(stats?.cacheHits ?? '…')} />
        </tbody>
      </table>
    </div>
  );
}

function Row(props: { label: string; value: string }): h.JSX.Element {
  return (
    <tr>
      <td style={{ color: 'var(--gr-text-muted)', padding: '3px 0' }}>{props.label}</td>
      <td style={{ textAlign: 'right', fontWeight: 600 }}>{props.value}</td>
    </tr>
  );
}
