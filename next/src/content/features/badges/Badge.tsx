/**
 * game-radar v2 — 徽章组件（Preact）
 * Badge component: every visual state of a title resolution, type-exhaustive.
 * Old world: three badge families + inline styles; new world: one component,
 * tokens from CSS custom properties, text via locale dict.
 */
import { h } from 'preact';
import type { TitleResolution } from '../../../steam/types.js';
import { palette } from '../../../ui/tokens.js';
import { t } from '../../../locales/zh-CN.js';

export function Badge(props: { resolution: TitleResolution; onRetry: () => void }): h.JSX.Element {
  const { resolution: r } = props;
  const base: h.JSX.CSSProperties = {
    display: 'inline-block',
    padding: '2px 6px',
    marginRight: '4px',
    fontSize: 'var(--gr-font-size-badge)',
    borderRadius: '2px',
    verticalAlign: 'middle',
    fontFamily: 'inherit'
  };

  switch (r.kind) {
    case 'steam': {
      const suspected = r.confidence === 'suspected';
      const rate =
        r.positiveRate === null
          ? t('badge.noReviews')
          : `${r.positiveRate}% ${t('badge.steamHit', { rate: '', total: r.totalReviews }).split('·')[1]?.trim() ?? ''}`;
      return (
        <span
          className="gr2 gr-badge"
          title={`${r.name}（AppID ${r.appId}）\n${r.reason}${suspected ? ` · ${t('badge.suspected')}` : ''}`}
          style={{
            ...base,
            color: suspected ? palette.suspect : palette.steamBlue,
            background: suspected ? 'rgba(255,204,51,0.12)' : 'rgba(103,193,245,0.12)',
            border: suspected ? '1px dashed #ffcc33' : '1px solid rgba(103,193,245,0.4)',
            fontWeight: 600
          }}
        >
          {(suspected ? `${t('badge.suspected')} ` : '') + rate}
        </span>
      );
    }
    case 'platform': {
      const isEmu = r.platform === 'emulator';
      return (
        <span
          className="gr2 gr-badge"
          title={isEmu ? t('badge.platformEmulator') : t('badge.platformConsole')}
          style={{
            ...base,
            color: palette.textMuted,
            background: 'rgba(143,152,160,0.12)',
            border: '1px dashed #555'
          }}
        >
          {isEmu
            ? r.tag
            : `${r.tag} · ${r.metascore !== null ? t('badge.metascore', { score: r.metascore }) : t('badge.metascoreMissing')}`}
        </span>
      );
    }
    case 'not-found':
      return (
        <span className="gr2 gr-badge" style={{ ...base, color: '#666', background: 'rgba(102,102,102,0.08)' }}>
          {t('badge.notFound')}
        </span>
      );
    case 'failed':
      return (
        <span
          className="gr2 gr-badge"
          onClick={props.onRetry}
          title="点击立即重查"
          style={{
            ...base,
            color: '#b8860b',
            background: 'rgba(184,134,11,0.12)',
            border: '1px dashed #b8860b',
            cursor: 'pointer'
          }}
        >
          {t('badge.failedNetwork')}
        </span>
      );
  }
}

/** metascore 色值由 token 函数给（MC 分级与 Steam 分级有意异源） */
