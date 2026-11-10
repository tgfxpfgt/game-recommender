/**
 * 游戏雷达 Game Radar - LLM 调用单源（v14.12 B6，报告 B P2-08）
 *
 * engine.js（评分）与 steam/ai-fallback.js（匹配）此前各持一份 Ollama/
 * OpenAI 兼容双分支调用块（payload 构造与响应提取同构）——本模块收敛
 * HTTP 调用与文本提取，调用方只构造 payload 与解析业务结果。
 * Single LLM call source: provider branch (Ollama local / OpenAI-compatible)
 * + response text extraction; callers build payloads and parse business
 * results themselves (the two sites intentionally differ there).
 */
import { fetchWithTimeout, isSafeFetchUrl } from './utils.js';

/**
 * 远程（OpenAI 兼容）LLM 端点准入断言。
 *
 * v14.26.0（优化方案 P1-1）：此前 openai 分支与 local 分支同样带
 * `allowPrivateHosts: true`——用户把 API Key 配到 OpenAI 兼容服务时，一旦
 * 端点被改成内网/本机地址（或配置被备份导入替换），Bearer 密钥会被发往
 * 私有地址。远程分支只允许 https + 非本机/非私有地址；本地 Ollama 分支
 * 仍允许私有地址（这是它的正常用法）。
 * Remote (OpenAI-compatible) endpoints must be https and non-private; the local
 * Ollama branch keeps private-host allowance by design.
 * @param {string} endpoint 用户配置的端点
 * @returns {void} 不合法时抛出（调用方已有 try/catch 兜底）
 */
export function assertRemoteLlmEndpoint(endpoint) {
  let parsed;
  try {
    parsed = new URL(String(endpoint));
  } catch {
    throw new Error('llm-endpoint-invalid: 端点不是合法 URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('llm-endpoint-insecure: 远程 LLM 端点必须使用 https');
  }
  // isSafeFetchUrl 拒绝 localhost / *.localhost / 私有与保留 IPv4 / 非法 IPv6
  if (!isSafeFetchUrl(String(endpoint))) {
    throw new Error('llm-endpoint-blocked: 远程 LLM 端点不得指向本机或私有地址');
  }
}

/**
 * 调用 LLM 并返回模型文本输出。
 * @param {{provider: string, endpoint: string, apiKey?: string, model?: string,
 *   temperature?: number}} cfg 用户 LLM 配置（local 允许私有地址；远程要求 https 公网）
 * @param {Object} body 请求体（不含 model/temperature——由本函数按 provider 统一注入）
 * @param {number} timeoutMs 超时（走 PERF_CONFIG 单源）
 * @returns {Promise<string>} 模型文本输出（失败抛出，调用方兜底）
 */
export async function callLlm(cfg, body, timeoutMs) {
  const isLocal = cfg.provider === 'local';
  if (!isLocal) assertRemoteLlmEndpoint(cfg.endpoint);
  const base = isLocal
    ? {
        // Ollama 本地模型（端点用户显式配置，允许私有地址）
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        allowPrivateHosts: true,
        body: JSON.stringify({
          model: cfg.model,
          stream: false,
          options: { temperature: cfg.temperature ?? 0 },
          ...body
        })
      }
    : {
        // OpenAI 兼容接口（远程：禁止私有地址，见 assertRemoteLlmEndpoint）
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {})
        },
        body: JSON.stringify({
          model: cfg.model,
          temperature: cfg.temperature ?? 0,
          ...body
        })
      };
  const resp = await fetchWithTimeout(cfg.endpoint, base, timeoutMs);
  const data = await resp.json();
  if (isLocal) return String(data.response || '');
  return String((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '');
}
