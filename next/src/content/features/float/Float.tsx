/**
 * game-radar v2 — 详情浮窗（Preact）
 * Float: three-state detail rendering (steam hit / platform / not-found /
 * failed) + the platform-declaration bar. All text via locale dict; colors
 * via tokens. Old world's 510-line sidebar template collapses into one
 * type-exhaustive component tree.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import type { DetailData } from '../../../steam/types.js';
import type { JSX } from 'preact';
import { PLATFORM_GROUPS } from '../../../steam/platforms.js';
import { metascoreColor, palette } from '../../../ui/tokens.js';
import { t } from '../../../locales/zh-CN.js';

const panel = {
  fontFamily: 'inherit',
  color: 'var(--gr-text-primary)',
  background: 'var(--gr-panel-bg)',
  border: '1px solid var(--gr-panel-border)',
  borderRadius: '6px',
  padding: '12px 14px',
  margin: '10px 0',
  fontSize: '12px',
  lineHeight: 1.6,
  maxWidth: '420px'
};

const chip = {
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: '3px',
  marginRight: '6px'
};

function DeclareBar(props: {
  onDeclare: (platformId: string) => Promise<{ metascore: number | null; tag: string }>;
  disabled?: boolean;
}): h.JSX.Element {
  const [platformId, setPlatformId] = useState('switch');
  const [busy, setBusy] = useState(false);
  return (
    <div style={{ marginTop: '8px', display: 'flex', gap: '6px', alignItems: 'center' }}>
      <select
        id="gr2-declare-select"
        value={platformId}
        disabled={busy || props.disabled}
        onChange={(e) => setPlatformId((e.target as HTMLSelectElement).value)}
        style={{
          flex: 1,
          padding: '4px',
          background: 'var(--gr-dark-bg)',
          color: 'var(--gr-text-primary)',
          border: '1px solid var(--gr-panel-border)',
          borderRadius: '3px',
          fontSize: '11px'
        }}
      >
        {PLATFORM_GROUPS.map((g) => (
          <optgroup key={g.brand} label={g.label}>
            {g.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <button
        id="gr2-declare-btn"
        type="button"
        disabled={busy || props.disabled}
        onClick={async () => {
          setBusy(true);
          try {
            await props.onDeclare(platformId);
          } finally {
            setBusy(false);
          }
        }}
        style={{
          padding: '4px 10px',
          background: 'var(--gr-steam-blue)',
          color: '#fff',
          border: 'none',
          borderRadius: '3px',
          cursor: 'pointer',
          fontSize: '11px'
        }}
      >
        {busy ? '…' : '声明机型'}
      </button>
    </div>
  );
}

export function Float(props: {
  detail: DetailData;
  onDeclare: (platformId: string) => Promise<{ metascore: number | null; tag: string }>;
  onRetry: () => void;
}): JSX.Element {
  const { detail: d } = props;
  const title = (
    <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--gr-text-primary)', marginBottom: '8px' }}>
      {d.title}
    </div>
  );

  switch (d.kind) {
    case 'steam': {
      const suspected = d.confidence === 'suspected';
      const bar =
        d.positiveRate === null ? null : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '6px 0' }}>
            <div
              style={{ flex: 1, height: '8px', background: 'rgba(0,0,0,0.3)', borderRadius: '4px', overflow: 'hidden' }}
            >
              <div style={{ width: `${d.positiveRate}%`, height: '100%', background: 'var(--gr-steam-blue)' }} />
            </div>
            <span style={{ fontWeight: 700, color: 'var(--gr-steam-blue)' }}>{d.positiveRate}%</span>
            <span style={{ color: 'var(--gr-text-muted)' }}>{d.totalReviews.toLocaleString()} 评测</span>
          </div>
        );
      const recent =
        d.recent !== null ? (
          <div style={{ color: 'var(--gr-text-muted)', fontSize: '11px' }}>
            近 30 天：{d.recent.rate}%（{d.recent.total.toLocaleString()} 篇）
          </div>
        ) : null;
      return (
        <div style={panel}>
          {title}
          {d.headerImage ? (
            <img
              src={d.headerImage}
              alt=""
              style={{ width: '100%', borderRadius: '4px', marginBottom: '8px' }}
              onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
            />
          ) : null}
          {bar}
          {recent}
          {d.description ? (
            <p style={{ margin: '8px 0', color: 'var(--gr-text-primary)', opacity: 0.85 }}>
              {d.description.length > 140 ? `${d.description.slice(0, 140)}…` : d.description}
            </p>
          ) : null}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
            {suspected ? (
              <span style={{ ...chip, color: palette.suspect, border: '1px dashed #ffcc33' }}>
                {t('badge.suspected')} · {d.reason}
              </span>
            ) : null}
            {d.releaseDate ? <span style={{ color: 'var(--gr-text-muted)' }}>🗓 {d.releaseDate}</span> : null}
            <a
              href={`https://store.steampowered.com/app/${d.appId}/`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--gr-steam-blue)' }}
            >
              商店页 ↗
            </a>
            <span style={{ color: 'var(--gr-text-muted)' }}>AppID {d.appId}</span>
          </div>
          {d.reviews.length > 0 ? (
            <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px solid var(--gr-panel-border)' }}>
              {d.reviews.map((rv, i) => (
                <div key={i} style={{ margin: '4px 0', color: rv.recommended ? 'var(--gr-steam-blue)' : '#c1714a' }}>
                  {rv.recommended ? '👍' : '👎'} {rv.content}
                  {rv.date ? <span style={{ color: 'var(--gr-text-muted)' }}> · {rv.date}</span> : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      );
    }
    case 'platform': {
      const isEmu = d.platform === 'emulator';
      return (
        <div style={panel}>
          {title}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '8px 0', flexWrap: 'wrap' }}>
            <span style={{ ...chip, fontWeight: 700, color: '#fff', background: metascoreColor(d.metascore) }}>
              {d.metascore !== null ? `MC ${d.metascore}` : 'MC —'}
            </span>
            <span style={{ ...chip, color: 'var(--gr-text-primary)', border: '1px dashed var(--gr-panel-border)' }}>
              🎮 {d.tag}
            </span>
          </div>
          <div style={{ color: 'var(--gr-text-muted)', marginBottom: '8px' }}>
            {isEmu
              ? t('badge.platformEmulator')
              : d.metascore !== null
                ? `${t('badge.platformConsole')} · Metacritic 评分${d.source === 'declared' ? '（已按声明记录，长期生效）' : ''}`
                : `${t('badge.platformConsole')}（MC 暂无评分，后续访问自动补查）`}
          </div>
          <DeclareBar onDeclare={props.onDeclare} />
        </div>
      );
    }
    case 'not-found':
      return (
        <div style={panel}>
          {title}
          <div style={{ color: 'var(--gr-text-muted)', margin: '6px 0' }}>
            {t('badge.notFound')}——确认 Steam 无此游戏（负缓存期内自动重试）。
          </div>
          <DeclareBar onDeclare={props.onDeclare} />
        </div>
      );
    case 'failed':
      return (
        <div style={panel}>
          {title}
          <div style={{ color: '#b8860b', margin: '6px 0' }}>
            {t('badge.failedNetwork')}（失败未知，非「未找到」——点击重查）。
          </div>
          <button
            type="button"
            onClick={props.onRetry}
            style={{
              padding: '4px 12px',
              background: 'rgba(184,134,11,0.15)',
              color: '#b8860b',
              border: '1px dashed #b8860b',
              borderRadius: '3px',
              cursor: 'pointer'
            }}
          >
            重查
          </button>
        </div>
      );
  }
}
