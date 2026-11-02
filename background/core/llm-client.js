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
import { fetchWithTimeout } from './utils.js';

/**
 * 调用 LLM 并返回模型文本输出。
 * @param {{provider: string, endpoint: string, apiKey?: string, model?: string,
 *   temperature?: number}} cfg 用户 LLM 配置（endpoint 用户显式配置，允许私有地址）
 * @param {Object} body 请求体（不含 model/temperature——由本函数按 provider 统一注入）
 * @param {number} timeoutMs 超时（走 PERF_CONFIG 单源）
 * @returns {Promise<string>} 模型文本输出（失败抛出，调用方兜底）
 */
export async function callLlm(cfg, body, timeoutMs) {
  const base =
    cfg.provider === 'local'
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
          // OpenAI 兼容接口
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {})
          },
          allowPrivateHosts: true,
          body: JSON.stringify({
            model: cfg.model,
            temperature: cfg.temperature ?? 0,
            ...body
          })
        };
  const resp = await fetchWithTimeout(cfg.endpoint, base, timeoutMs);
  const data = await resp.json();
  if (cfg.provider === 'local') return String(data.response || '');
  return String((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '');
}
