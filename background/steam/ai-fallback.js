// @ts-strict
/**
 * 游戏雷达 Game Radar - AI/LLM 匹配兜底 / AI Match Fallback
 *
 * v6.4.16：规则匹配（storesearch 静态候选 + 删词变体）全部失败时，用用户
 * 配置的 LLM 从下载站标题提取 Steam 官方游戏名（或直接给出 appid），再经
 * storesearch / appdetails **官方数据校验**（防幻觉）确认后才采用。成功结果
 * 缓存 7 天（llm-cache），失败缓存 24 小时（防反复打 LLM）。
 *
 * 触发条件：settings.useLLM 开启且 llmConfig.endpoint 已配置；未配置时
 * 静默返回 null（纯规则路径不受影响）。
 *
 * When rule-based matching fails, ask the configured LLM for the official
 * Steam name/appid, then verify against storesearch/appdetails before adopting
 * (hallucination guard). Successful matches cache 7d, failures 24h.
 */
import { getSettings } from '../core/settings.js';
import { fetchWithTimeout } from '../core/utils.js';
import { Logger } from '../storage/logger.js';
import { getLlmMatch, setLlmMatch, getWebMatch, setWebMatch } from '../storage/llm-cache.js';
import { searchSteamAppId, namesRelated } from './api-search.js';
import { fetchSteamAppDetails } from './api-details.js';

const LLM_FETCH_TIMEOUT = 30000; // LLM 生成较慢 / LLM generation is slow

// ============ v6.4.17：搜索引擎兜底（Bing，免费无需配置） ============
// 规则匹配失败时用 Bing 搜索"标题 steam"，从结果页提取 store.steampowered.com
// 官方链接 → appdetails 官方名校验 + 标题相关性校验（防无关链接）→ 采用。
// 成功缓存 7d / 失败缓存 24h（独立 web: 键，与 LLM 兜底互不阻断）。

// 解析 Bing 搜索结果 HTML → Steam appid 列表（去重保序）。纯函数，可单测。
// Parse Bing results HTML for store.steampowered.com/app/{id} links.
export function parseBingSearchAppIds(html) {
  const ids = [];
  const seen = new Set();
  const re = /store\.steampowered\.com\/app\/(\d+)/g;
  for (const m of String(html || '').matchAll(re)) {
    const id = m[1];
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

const BING_SEARCH_URL = 'https://cn.bing.com/search?q=';
const BING_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/**
 * 搜索引擎兜底：Bing 搜索 → Steam 官方链接 → appdetails 校验。
 * @param {string} rawName - 下载站原始标题
 * @param {string|number|null} [excludeAppId] - 曾报错的错误 appid（黑名单）
 * @returns {Promise<import('../core/types.js').SteamSearchResult|null>}
 */
export async function webSearchFallback(rawName, excludeAppId) {
  if (!rawName) return null;
  try {
    // v6.4.19：辅助站开关——关闭 Bing 数据源则不调用搜索兜底
    const settings = await getSettings();
    const sources = settings.dataSources || {};
    if (sources.bing === false) return null;
    const cached = await getWebMatch(rawName);
    if (cached) {
      if (cached.ok && cached.appId) {
        return { appId: cached.appId, name: cached.name, englishName: cached.name, aiFallback: true };
      }
      return null;
    }
    // cn.bing.com 为公网域名（fetchWithTimeout 的 SSRF host 校验放行）；
    // 搜索词经 encodeURIComponent 编码，无注入面
    const searchUrl = BING_SEARCH_URL + encodeURIComponent(rawName + ' steam');
    const resp = await fetchWithTimeout(
      searchUrl,
      { headers: { 'User-Agent': BING_UA } },
      15000
    );
    const html = await resp.text();
    const appIds = parseBingSearchAppIds(html)
      .filter((id) => String(id) !== String(excludeAppId))
      .slice(0, 5);
    for (const appId of appIds) {
      const detail = await fetchSteamAppDetails(String(appId));
      if (detail && detail.name && namesRelated(rawName, detail.name)) {
        const numericId = Number(appId);
        await setWebMatch(rawName, { ok: true, appId: numericId, name: detail.name });
        Logger.info('搜索兜底', `${rawName} → ${detail.name} (${numericId})`);
        return { appId: numericId, name: detail.name, englishName: detail.name, aiFallback: true };
      }
    }
    await setWebMatch(rawName, { ok: false });
    return null;
  } catch (e) {
    Logger.warn('搜索兜底', '搜索引擎兜底失败', String(e));
    return null;
  }
}

/**
 * LLM 匹配兜底入口：规则匹配失败后调用；未配置 LLM 或校验失败返回 null。
 * @param {string} rawName - 下载站原始标题
 * @param {string|number|null} [excludeAppId] - 曾报错的错误 appid（黑名单）
 * @returns {Promise<import('../core/types.js').SteamSearchResult|null>}
 */
export async function llmMatchGame(rawName, excludeAppId) {
  if (!rawName) return null;
  const settings = await getSettings();
  const cfg = settings.llmConfig;
  if (!settings.useLLM || !cfg || !cfg.endpoint) return null;
  try {
    // 缓存：成功 7d / 失败 24h（llm-cache 按 ok 区分 TTL）
    const cached = await getLlmMatch(rawName);
    if (cached) {
      if (cached.ok && cached.appId) {
        return { appId: cached.appId, name: cached.name, englishName: cached.name, aiFallback: true };
      }
      return null;
    }
    const llm = await askLlmForOfficialName(rawName, cfg);
    if (!llm) {
      await setLlmMatch(rawName, { ok: false });
      return null;
    }
    // 校验路径 1：LLM 官方名 → storesearch（官方索引确认）
    if (llm.name) {
      const result = await searchSteamAppId([llm.name], llm.name, excludeAppId);
      if (result && namesRelated(llm.name, result.name)) {
        await setLlmMatch(rawName, { ok: true, appId: result.appId, name: result.name });
        Logger.info('AI兜底', `${rawName} → ${result.name} (${result.appId})`);
        return { appId: result.appId, name: result.name, englishName: result.name, aiFallback: true };
      }
    }
    // 校验路径 2：LLM 直接给 appid → appdetails 官方名校验（防幻觉）
    if (llm.appId) {
      const detail = await fetchSteamAppDetails(String(llm.appId));
      if (detail && detail.name && namesRelated(rawName, detail.name)) {
        const appId = detail.appId || llm.appId;
        await setLlmMatch(rawName, { ok: true, appId, name: detail.name });
        Logger.info('AI兜底', `${rawName} → ${detail.name} (${appId}) [appdetails]`);
        return { appId, name: detail.name, englishName: detail.englishName || detail.name, aiFallback: true };
      }
    }
    // 校验均未通过：不信任 LLM 输出
    await setLlmMatch(rawName, { ok: false });
    return null;
  } catch (e) {
    Logger.warn('AI兜底', 'LLM 匹配兜底失败', String(e));
    return null;
  }
}

/**
 * 询问 LLM：从标题提取 Steam 官方游戏名与可选 appid。
 * 纯函数解析独立导出（单测覆盖）。返回 {name, appId} 或 null。
 * @param {string} rawName - 下载站原始标题
 * @param {{provider: string, endpoint: string, apiKey?: string, model?: string, temperature?: number}} cfg
 * @returns {Promise<{name: string|null, appId: number|null}|null>}
 */
export async function askLlmForOfficialName(rawName, cfg) {
  const prompt = `你是 Steam 游戏数据库查询助手。根据下载站游戏标题找出对应的 Steam 官方游戏条目。
规则：
- 只返回 Steam 商店上真实存在的官方名称，优先英文原名（如 "Resident Evil Requiem"）
- 忽略版本信息、修改器、DLC、平台标记、日期、下载信息等噪声
- 标题可能是中文、英文或混合；官方名可能是任意语言
- 不确定时 name 返回空字符串，appid 返回 null
- 若你有把握直接给出 Steam AppID，appid 填数字；否则 null
只返回一行 JSON，格式：{"name": "官方游戏名或空", "appid": 数字或null}

标题：${rawName}`;
  try {
    let text = '';
    if (cfg.provider === 'local') {
      // Ollama 本地模型（端点用户显式配置，允许私有地址）
      const resp = await fetchWithTimeout(
        cfg.endpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          allowPrivateHosts: true,
          body: JSON.stringify({ model: cfg.model, prompt, stream: false, options: { temperature: cfg.temperature ?? 0 } })
        },
        LLM_FETCH_TIMEOUT
      );
      const data = await resp.json();
      text = String(data.response || '');
    } else {
      // OpenAI 兼容接口
      const resp = await fetchWithTimeout(
        cfg.endpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) },
          allowPrivateHosts: true,
          body: JSON.stringify({
            model: cfg.model,
            messages: [
              { role: 'system', content: '你只输出 JSON。' },
              { role: 'user', content: prompt }
            ],
            temperature: cfg.temperature ?? 0
          })
        },
        LLM_FETCH_TIMEOUT
      );
      const data = await resp.json();
      text = String((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '');
    }
    return parseLlmMatchResponse(text);
  } catch {
    return null;
  }
}

// 解析 LLM 响应（防御：JSON 包裹/散落文本/引号污染）。纯函数，可单测。
// Parse the LLM response defensively (JSON block, stray text, quoting).
export function parseLlmMatchResponse(text) {
  const raw = String(text || '');
  const m = raw.match(/\{[\s\S]*?\}/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]);
    const name = typeof obj.name === 'string' ? obj.name.trim().slice(0, 200) : '';
    const appId = typeof obj.appid === 'number' && Number.isInteger(obj.appid) && obj.appid > 0 ? obj.appid : null;
    if (!name && !appId) return null;
    return { name: name || null, appId };
  } catch {
    return null;
  }
}
