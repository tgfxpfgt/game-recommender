/**
 * game-radar v2 — 出站网络层（限速 + 熔断 + 超时）
 * Outbound net layer: per-host min-interval slotting, consecutive-fail circuit
 * breaker, AbortController timeout. deps injected → unit-testable.
 *
 * 与旧世界对照：fetchWithTimeout（全函数）+ api-monitor（分域熔断）两处职责，
 * v2 收敛为一个可注入依赖的紧凑层；SSRF 校验由 manifest host_permissions +
 * 构造期常量 URL 承担（本层不拼任意 URL）。
 */

export class NetError extends Error {
  constructor(
    public readonly code: 'network' | 'ratelimit' | 'circuit-open' | 'timeout',
    message: string
  ) {
    super(`[${code}] ${message}`);
    this.name = 'NetError';
  }
}

export interface NetOptions {
  /** 请求超时（默认 10s） */
  timeoutMs?: number;
}

export interface NetDeps {
  /** 注入 fetch（SW 全局 / 测试桩） */
  fetchImpl: typeof fetch;
  /** 时钟注入（限速/熔断测试用） */
  now?: () => number;
  /** steam 主机最小请求间隔（默认 150ms——防限流） */
  minIntervalMs?: number;
  /** 请求超时（默认 10s） */
  timeoutMs?: number;
  /** 连续失败 N 次熔断（默认 5） */
  breakerThreshold?: number;
  /** 熔断开启时长（默认 60s） */
  breakerOpenMs?: number;
}

interface HostState {
  lastCallAt: number;
  consecutiveFails: number;
  openUntil: number;
}

const DEFAULTS = {
  timeoutMs: 10_000,
  minIntervalMs: 150,
  breakerThreshold: 5,
  breakerOpenMs: 60_000
};

export function createNet(deps: NetDeps) {
  const now = deps.now ?? (() => Date.now());
  const interval = deps.minIntervalMs ?? DEFAULTS.minIntervalMs;
  const threshold = deps.breakerThreshold ?? DEFAULTS.breakerThreshold;
  const openMs = deps.breakerOpenMs ?? DEFAULTS.breakerOpenMs;
  const timeoutMs = deps.timeoutMs ?? DEFAULTS.timeoutMs;
  const hosts = new Map<string, HostState>();

  function hostState(host: string): HostState {
    let st = hosts.get(host);
    if (!st) {
      st = { lastCallAt: 0, consecutiveFails: 0, openUntil: 0 };
      hosts.set(host, st);
    }
    return st;
  }

  function hostOf(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  }

  /**
   * 限速 + 熔断守卫的 GET（JSON 预期）。
   * 熔断开启期直接抛 circuit-open（零出站）；请求/响应异常计入连续失败。
   */
  async function getJson<T>(url: string, opts: { timeoutMs?: number } = {}): Promise<T> {
    const host = hostOf(url);
    const st = hostState(host);
    const limit = opts.timeoutMs ?? timeoutMs;

    if (now() < st.openUntil) {
      throw new NetError('circuit-open', `${host} 熔断中（至 ${st.openUntil}）`);
    }
    // 预约制限速：同步段内领槽（并发调用各得相邻槽位）
    const slot = Math.max(st.lastCallAt + interval, now());
    st.lastCallAt = slot;
    const wait = slot - now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), limit);
    try {
      const resp = await deps.fetchImpl(url, { signal: ctl.signal });
      if (!resp.ok) {
        st.consecutiveFails++;
        if (st.consecutiveFails >= threshold) st.openUntil = now() + openMs;
        throw new NetError('network', `${host} HTTP ${resp.status}`);
      }
      const json = (await resp.json()) as T;
      st.consecutiveFails = 0;
      return json;
    } catch (e) {
      // AbortError 归一为 timeout；网络层错误计连续失败（熔断计数）
      const code = e instanceof DOMException && e.name === 'AbortError' ? 'timeout' : 'network';
      if (code !== 'timeout') {
        st.consecutiveFails++;
        if (st.consecutiveFails >= threshold) st.openUntil = now() + openMs;
      }
      if (e instanceof NetError) throw e;
      throw new NetError(code, `${host} ${String(e).slice(0, 120)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  return { getJson };
}

export type Net = ReturnType<typeof createNet>;
