// ==UserScript==
// @name         游戏雷达 Game Radar (油猴版)
// @name:en      Game Radar (Userscript)
// @namespace    tgfxpfgt.game-recommender
// @version      14.29.0
// @description  下载站 Steam 好评率徽章 + 详情页信息浮窗 + 智能匹配——扩展核心功能移植（列表徽章/近30天好评率/红标题/等待队列/低评测提示/匹配置信度推测徽章/同站冲突防线/网络异常三态/详情浮窗/手动选择/负缓存分级退避）
// @description:en  Steam rating badges on download sites + detail float + smart matching (ported from the Chrome extension core).
// @author       GameRecommender
// @match        *://*.xdgame.com/*
// @match        *://*.xianyudanji.gg/*
// @match        *://*.gamer520.com/*
// @match        *://*.gamers520.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_registerMenuCommand
// @connect      store.steampowered.com
// @connect      steamcommunity.com
// @connect      steamspy.com
// @connect      cdn.akamai.steamstatic.com
// @connect      cdn.cloudflare.steamstatic.com
// @connect      media.steampowered.com
// @run-at       document-idle
// @noframes
// @license      MIT
// @supportURL   https://github.com/tgfxpfgt/game-recommender/issues
// @updateURL    https://raw.githubusercontent.com/tgfxpfgt/game-recommender/main/userscript/game-radar.user.js
// @downloadURL  https://raw.githubusercontent.com/tgfxpfgt/game-recommender/main/userscript/game-radar.user.js
// ==/UserScript==

/**
 * 游戏雷达 Game Radar —— 油猴版（userscript/game-radar.user.js）
 *
 * 由 Chrome MV3 扩展核心功能移植（移植基线 v14.29.0，功能口径 = 匹配管线
 * 与徽章核心对齐扩展）：列表页好评率徽章（含推测匹配琥珀徽章）、详情页
 * Steam 信息浮窗、标题智能匹配管线（storesearch 全词扫描 + 跨词共识 +
 * 社区英文兜底 + 英文段重搜 + DLC 解析 + 匹配置信度门 + 同站 appId 冲突
 * 防线 + URL 索引仲裁写入）、故障三态（网络异常 ≠ 未找到）、负缓存分级
 * 退避、熔断器、限速队列。运行于 Tampermonkey 沙箱：
 *   - chrome.storage / OPFS  → GM_getValue/GM_setValue（平键 + TTL 信封）
 *   - fetchWithTimeout(SW)   → GM_xmlhttpRequest（无 CORS 限制，跨域直连）
 *   - background 消息管线    → 同进程直调（resolve/rate 两段直连）
 * 与扩展的口径差异（有意保留）：SW 编排类能力不适用于油猴运行模型——
 * 扩展的诊断轨迹/使用证据档案/批量任务看门狗与排队治理/多 worker 并发/
 * 手动主机机型声明/非 PC 平台识别子系统（置信度平台门恒视为 PC）均不在
 * 移植面；数据形态差异：评分缓存无 cnReviews 模块（倒挂指纹不适用）。
 * Ported from the MV3 extension core (baseline v14.29.0). Storage via GM_*
 * keys, network via GM_xmlhttpRequest; the search pipeline runs in-page.
 */
(function (global) {
  'use strict';

  // ==================================================================
  // §0 常量单源（对齐扩展 constants.js / PERF_CONFIG / api-reviews.js）
  // Single-source constants (aligned with the extension).
  // ==================================================================
  const SCRIPT_VERSION = '14.29.0';
  const KEY_PREFIX = 'grUs:';

  const ENDPOINTS = {
    steamSearch: 'https://store.steampowered.com/api/storesearch/',
    steamAppDetails: 'https://store.steampowered.com/api/appdetails',
    steamStoreApp: 'https://store.steampowered.com/app/',
    communitySearch: 'https://steamcommunity.com/actions/SearchApps/',
    steamCdnHeader: (appId) => 'https://cdn.akamai.steamstatic.com/steam/apps/' + appId + '/header.jpg'
  };

  const PERF = {
    steamMinIntervalMs: 150, // Steam 域请求最小间隔（扩展 PERF_CONFIG.steamRateLimitMs）
    searchTimeoutMs: 10000, // storesearch/社区搜索超时（扩展 fetchTimeoutSearch 组）
    pageTimeoutMs: 15000, // 商店页 HTML 回退超时（回退解析需整页）
    anomalyExtraGapMs: 2000 // 失败率异常时的批内附加间隔（扩展 anomaly 降速的轻量形态）
  };

  const CIRCUIT = { threshold: 5, openMs: 60000 }; // api-monitor.js 同参
  const TTL = {
    ratingMs: 72 * 3600e3, // TTL_CONFIG.detailSteam（72h）
    metaMs: 30 * 24 * 3600e3, // TTL_CONFIG.metaSteam（30 天）
    negativeCapMs: 2 * 3600e3 // TTL_CONFIG.negativeCache（2h 上限）
  };
  const NEG_TIER_DIVISORS = [8, 2, 1]; // 分级退避阶梯值：15min → 1h → 2h（name-index.js 同阶梯；negativeTtlFor 内联消费）
  const RATING_RETRY_COOLDOWN_MS = 5 * 60 * 1000; // api-reviews.js 同值
  const RATING_RETRY_LONG_COOLDOWN_MS = 60 * 60 * 1000;
  const RATING_FAIL_RETRY_CAP = 3; // 失败固化重试上限（超限走长冷却）
  const NEW_RELEASE_WINDOW_DAYS = 90; // orchestrator-shared.js 同值
  const MAX_SCAN_LINKS = 500; // 列表页链接扫描上限（settings.maxScanLinks）
  const CACHE_CAPS = { rating: 800, urlIndex: 400, nameIndex: 600, manual: 100 }; // 有界存储
  const AUTO_RETRY_DELAY_MS = 30000; // 详情页网络故障期自动重查（v14.7 批次 9 语义）
  const RED_TITLE_DEFAULT = 95; // redTitleRating 默认（总+近30天 均 > 阈值）

  // ==================================================================
  // §0.1 GM 存储适配（平键 + JSON 信封；写穿读缓存）
  // GM storage adapter: flat keys with JSON envelopes + in-memory cache.
  // ==================================================================
  const memStore = new Map();
  const gmStore = {
    get(key, fallback) {
      const k = KEY_PREFIX + key;
      if (memStore.has(k)) return memStore.get(k);
      try {
        const raw = typeof GM_getValue === 'function' ? GM_getValue(k, undefined) : undefined;
        const val = raw === undefined ? fallback : JSON.parse(raw);
        memStore.set(k, val);
        return val;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      const k = KEY_PREFIX + key;
      memStore.set(k, value);
      try {
        if (typeof GM_setValue === 'function') GM_setValue(k, JSON.stringify(value));
      } catch {
        /* 存储满等异常：内存态仍生效 */
      }
    },
    del(key) {
      const k = KEY_PREFIX + key;
      memStore.delete(k);
      try {
        if (typeof GM_deleteValue === 'function') GM_deleteValue(k);
      } catch {
        /* ignore */
      }
    },
    keys() {
      // v14.29.0：内存缓存与 GM_listValues 取并集——写穿前/桩环境下 keys()
      // 也能看到已写键（原实现只读 GM_listValues，GM 侧延迟可见时枚举为空）
      const seen = new Set();
      for (const k of memStore.keys()) {
        if (String(k).indexOf(KEY_PREFIX) === 0) seen.add(String(k).slice(KEY_PREFIX.length));
      }
      try {
        const all = typeof GM_listValues === 'function' ? GM_listValues() : [];
        for (const k of all) {
          if (String(k).indexOf(KEY_PREFIX) === 0) seen.add(String(k).slice(KEY_PREFIX.length));
        }
      } catch {
        /* ignore */
      }
      return [...seen];
    }
  };

  // ==================================================================
  // §0.2 网络层：GM_xmlhttpRequest + 限速槽 + 分域熔断
  // Network: GM request + sequential rate slot + per-domain circuit breaker.
  // ==================================================================
  let lastSteamCallAt = 0; // 限速槽（顺序队列下无债务积累，天然无突发视界问题）
  let anomalyExtraGapUntil = 0; // 失败率异常 → 批内附加间隔（扩展 anomaly 降速轻量形态）

  // 分域熔断（api-monitor.js 同语义：5 连失败开 60s，半开放行 1 探测）
  const circuits = {
    store: { fails: 0, openUntil: 0 },
    community: { fails: 0, openUntil: 0 }
  };
  // 滚动失败窗口（anomaly 判定：近 10 次 ≥5 次失败 → 附加间隔）
  const domainWindow = { store: [], community: [] };

  function recordDomainCall(domain, ok) {
    const w = domainWindow[domain];
    if (!w) return;
    w.push(ok ? 1 : 0);
    if (w.length > 10) w.shift();
    const total = w.length;
    const failed = total - w.reduce((a, b) => a + b, 0);
    if (total >= 5 && failed / total > 0.4) {
      anomalyExtraGapUntil = Date.now() + 60 * 1000; // 60s 内批请求加间隔
    }
    const c = circuits[domain];
    if (!c) return;
    if (ok) {
      c.fails = 0;
      c.openUntil = 0;
      return;
    }
    c.fails += 1;
    if (c.fails >= CIRCUIT.threshold) c.openUntil = Date.now() + CIRCUIT.openMs;
  }

  function isCircuitOpen(domain) {
    const c = circuits[domain];
    if (!c) return false;
    if (c.openUntil && Date.now() >= c.openUntil) {
      // 半开探测：放行本请求，失败重开
      c.openUntil = 0;
      c.fails = CIRCUIT.threshold - 1;
      return false;
    }
    return !!c.openUntil;
  }

  const domainOf = (url) => (String(url).indexOf('steamcommunity.com') >= 0 ? 'community' : 'store');

  /**
   * 统一出站请求（扩展 fetchWithTimeout 的 GM 形态：跨域直连 + 超时 + 限速 +
   * 熔断 + 分域统计）。返回 {ok, status, json, text, finalUrl}。
   * Unified outbound request. Resolves {ok,status,json,text,finalUrl};
   * rejects only on transport failure (pipeline treats throw = network down).
   */
  function gmFetch(url, opts) {
    const o = opts || {};
    const domain = domainOf(url);
    if (isCircuitOpen(domain)) {
      return Promise.reject(new Error('circuit-open:' + domain));
    }
    // 限速槽：与上一次 Steam 域请求保持最小间隔（扩展 steamRateLimitMs）
    const gap = PERF.steamMinIntervalMs + (Date.now() < anomalyExtraGapUntil ? PERF.anomalyExtraGapMs : 0);
    const wait = Math.max(0, lastSteamCallAt + gap - Date.now());
    lastSteamCallAt = Date.now() + wait;
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (typeof GM_xmlhttpRequest !== 'function') {
          reject(new Error('GM_xmlhttpRequest 不可用'));
          return;
        }
        let settled = false;
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          timeout: o.timeout || PERF.searchTimeoutMs,
          headers: { Accept: 'application/json, text/html;q=0.9, */*;q=0.8' },
          onload: (resp) => {
            if (settled) return;
            settled = true;
            const ok = resp.status >= 200 && resp.status < 300;
            recordDomainCall(domain, ok || resp.status === 404); // 404=空结果非失败（v14.10.1 doctrine）
            let json = null;
            let text = null;
            const ct = String((resp.responseHeaders && resp.responseHeaders['Content-Type']) || '');
            if (ct.indexOf('json') >= 0 || /^\s*[[{]/.test(String(resp.responseText || ''))) {
              try {
                json = JSON.parse(resp.responseText);
              } catch {
                json = null;
              }
            } else {
              text = resp.responseText;
            }
            resolve({ ok, status: resp.status, json, text, finalUrl: resp.finalUrl || url });
          },
          onerror: () => {
            if (settled) return;
            settled = true;
            recordDomainCall(domain, false);
            reject(new Error('network-error'));
          },
          ontimeout: () => {
            if (settled) return;
            settled = true;
            recordDomainCall(domain, false);
            reject(new Error('timeout'));
          }
        });
      }, wait);
    });
  }
  // ==================================================================
  // §1 词表与纯函数（shared/retrieval-vocab.js + api-search.js +
  // title-parser.js 逐字移植；golden 口径 = 扩展 v14.14.0 编译产物）
  // Vocab + pure functions ported verbatim from the extension.
  // ==================================================================
  const VOCAB = {
    // 中文标题噪声序列（retrieval-vocab RETRIEVAL_VOCAB.noiseTitle 逐字快照）
    noiseWords:
      '中文|汉化|破解|免安装|绿色|学习|未加密|完整版|豪华版|豪华|终极|数字|典藏|年度|重制|复刻|增强|正式|官方|简繁|简体|繁体|中英|多语言|特别版|标准版|支持者版|解压即撸|预购特典|预购|特典|抢先试玩|抢先体验|抢先|试玩|体验版|修改器|加速器|作弊|全季票|季票|顶置|置顶|汇总贴|汇总|索引|爆火|热门|版|全DLC|整合|硬盘|免DVD|CODEX|FLT|RELOADED|SKIDROW|EMPRESS|GOG|Razor1911|FitGirl|百度网盘|网盘|下载|游戏下载|免费下载|迅雷|磁力|BT|种子|支持手柄|手柄|支持|新游发布|免安装绿色版|Switch520.com|Switch520|520.com',
    noiseRe: [
      'v[\\d.]+',
      'V[\\d.]+',
      '\\d+\\.\\d+[\\d.]*',
      'Build[.\\s]*\\d+',
      'update\\s*\\d+',
      'DLC.*',
      '\\d+\\s*GB',
      '\\s+The\\s+Game\\s*'
    ],
    tailStrip: '下载|游戏下载|免费下载|破解版|汉化版|中文版|绿色版|免安装',
    editionWords:
      'edition|enhanced|deluxe|upgrade|remastered|remaster|definitive|complete|goty|bundle|collection|demo|trial',
    junkCandidate:
      '豪华|解压即撸|预购特典|预购|特典|中文|汉化|破解|免安装|绿色|完整版|豪华版|终极|修改器|加速器|作弊|全季票|季票|pc|vr|3d|hd|build[.\\s]*\\d+|\\d+[\\d.]*|v[\\d.]+',
    addonPattern:
      'demo|试玩|trial|prologue|序章|序幕|soundtrack|ost|artbook|dlc|supporter pack|支持者包|fan pack|wallpaper|screenshot|原声带|美术集|设定集|艺术集|画集|壁纸|原画集|收藏版|内容包|扩展包|追加内容|组合包',
    demoPattern: 'demo|试玩|trial',
    enNoiseWords: 'build|plus|full|crack|repack|update',
    versionPairs: [
      ['增强版', 'Enhanced'],
      ['重制版', 'Remastered'],
      ['复刻版', 'Remake'],
      ['豪华版', 'Deluxe'],
      ['终极版', 'Ultimate'],
      ['年度版', 'Game of the Year'],
      ['典藏版', 'Collector'],
      ['黄金版', 'Gold']
    ]
  };

  // 检查词表快照是否完整（占位词注入即失真——防我方生成损坏的机器护栏）
  if (VOCAB.noiseWords.indexOf('alternating-placeholder') >= 0 || VOCAB.junkCandidate.indexOf('placeholder') >= 0) {
    throw new Error('GR-US vocab snapshot corrupted');
  }

  // 编译模式（对齐 getCompiledRetrievalRules 产物形态）
  const noiseAllRe = new RegExp(
    '(?:' +
      VOCAB.noiseWords
        .split('|')
        .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|') +
      '|' +
      VOCAB.noiseRe.join('|') +
      ')',
    'g'
  );
  const junkCandidateRe = new RegExp('^(?:' + VOCAB.junkCandidate + ')$', 'i');
  const addonNameRe = new RegExp('(?:' + VOCAB.addonPattern + ')', 'i');
  const demoNameRe = new RegExp('(?:' + VOCAB.demoPattern + ')', 'i');

  // 核心词提取（api-search.js coreTokensOf——v14.16.0 O8 逐字对齐扩展）：
  // CJK 连串 + EN 词（≥4 字符，排噪声集）；扩展口径无差别
  const noiseEnSet = new Set(VOCAB.enNoiseWords.split('|'));
  function coreTokensOf(text) {
    const norm = String(text || '').toLowerCase();
    const cjk = norm.match(/[\u4e00-\u9fff\u3400-\u4dbf]{2,}/g) || [];
    const en = (norm.match(/[a-z][a-z0-9']{3,}/g) || []).filter((w) => !noiseEnSet.has(w));
    return [...cjk, ...en];
  }

  // 序号语义（api-search.js seqNumsOf 逐字）：≤2 位序号，或标题唯一数字
  function seqNumsOf(s) {
    const all = String(s).match(/\d+/g) || [];
    const seq = all.filter((n) => n.length <= 2);
    if (seq.length === 0 && all.length === 1) seq.push(all[0]);
    return seq;
  }

  // 名称相关性校验（api-search.js nameMatchesSearch 逐字移植）
  function nameMatchesSearch(resultName, term, rawName) {
    const norm = (s) =>
      String(s || '')
        .toLowerCase()
        .replace(/[\s\-_:：|.'!！?？[\]()（）×•·]/g, '');
    const rn = norm(resultName);
    const tn = norm(term);
    if (!rn || !tn || rn.length < 2 || tn.length < 2) return false;
    if (/^[a-z]{1,3}$/.test(tn) && rn !== tn) return false;
    const rawNorm = norm(rawName);
    const idx = rawNorm.indexOf(tn);
    const next = idx >= 0 ? rawNorm[idx + tn.length] : '';
    const digitGap = !!next && /\d/.test(next) && !/\d/.test(rn);
    const cnOf = (s) => /[\u4e00-\u9fff]/.test(s);
    if (rn === tn) return !digitGap;
    if (rn.includes(tn)) return !digitGap;
    if (digitGap && cnOf(tn) === cnOf(rn)) return false;
    if (cnOf(tn) !== cnOf(rn)) {
      if (cnOf(tn)) {
        const rawEn = coreTokensOf(rawName).filter((w) => /^[a-z]/.test(w));
        const rEn = coreTokensOf(resultName).filter((w) => /^[a-z]/.test(w));
        if (rawEn.length > 0 && rawEn.some((w) => rEn.includes(w))) return true;
        if (seqNumsOf(rawName).some((n) => seqNumsOf(resultName).includes(n))) return true;
        return /\d/.test(rawName) && !/\d/.test(resultName);
      }
      return true;
    }
    return false;
  }

  // 候选打分（api-search.js matchCandidateScore——v14.16.0 O8 逐字对齐扩展）
  function matchCandidateScore(resultName, term, rawName) {
    const rn = String(resultName || '').toLowerCase();
    const tn = String(term || '').toLowerCase();
    const rTokens = coreTokensOf(resultName);
    const rawTokens = coreTokensOf(rawName);
    let score = 0;
    for (const w of rawTokens) {
      if (/^[a-z]/.test(w)) {
        if (rTokens.includes(w)) score += 3;
      } else if (rTokens.includes(w)) {
        score += 2;
      }
    }
    // 搜索词包含关系（扩展同款：全等 +2 / 包含 +1）
    if (rn === tn) score += 2;
    else if (tn.length >= 2 && rn.includes(tn)) score += 1;
    // 站点自命名整词包容（完整 CJK 搜索词被候选名包含 → +3）
    if (/[一-鿿]{2,}/.test(tn) && rn.includes(tn)) score += 3;
    // 数字一致性（seqNumsOf 单源；跨语言追加 +1；俗称序号例外 +1）
    const numAligned = seqNumsOf(rawName).some((x) => seqNumsOf(resultName).includes(x));
    if (numAligned) score += 1;
    if (numAligned && /[\u4e00-\u9fff]/.test(rawName) && !/[\u4e00-\u9fff]/.test(resultName)) {
      score += 1;
    }
    if (
      /[\u4e00-\u9fff]/.test(rawName) &&
      !/[\u4e00-\u9fff]/.test(resultName) &&
      /\d/.test(rawName) &&
      !/\d/.test(resultName)
    ) {
      score += 1;
    }
    return score;
  }

  // CJK 二元 Dice（orchestrator-list cjkBigramDice 语义对齐：复核信号）
  function cjkBigramDice(a, b) {
    const grab = (s) => {
      const set = new Set();
      const runs = String(s || '').match(/[\u4e00-\u9fff]{2,}/g) || [];
      for (const run of runs) {
        for (let i = 0; i < run.length - 1; i++) set.add(run.slice(i, i + 2));
      }
      return set;
    };
    const A = grab(a);
    const B = grab(b);
    if (A.size === 0 || B.size === 0) return 0;
    let inter = 0;
    for (const x of A) if (B.has(x)) inter++;
    return (2 * inter) / (A.size + B.size);
  }

  // 外族品牌前缀检测（api-search.js isCrossoverEntry 移植——仅前缀形状）
  function isCrossoverEntry(resultName, term, rawName) {
    const rn = String(resultName || '').toLowerCase();
    const tn = String(term || '').toLowerCase();
    const rawNorm = String(rawName || '').toLowerCase();
    const idx = rn.indexOf(tn);
    if (idx < 0) return false;
    const before = rn.slice(0, idx);
    for (const run of before.match(/[\u4e00-\u9fff]{2,}/g) || []) {
      const rest = run.replace(noiseAllRe, '');
      for (const m of rest.match(/[\u4e00-\u9fff]{2,}/g) || []) {
        if (!rawNorm.includes(m)) return true; // 外族品牌块
      }
    }
    return false;
  }

  // 版本坍缩排除（isEnEdition：候选名 = EN 段全名前缀且更长 → 排除）
  function isEnEdition(resultName, rawName) {
    const enSeg = (String(rawName).match(/[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ0-9 &:.'\-]{5,}/) || [''])[0].trim();
    if (!enSeg) return false;
    const norm = (s) =>
      String(s || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    const rn = norm(resultName);
    const en = norm(enSeg);
    if (!rn || !en) return false;
    return rn.startsWith(en) && rn.length > en.length;
  }

  // 候选 type 排名（api-search.js rankCandidatesByType 语义：game 优先去附属）
  function rankCandidatesByType(items) {
    const typeScore = (t) => (t === 'game' ? 0 : t === 'demo' ? 1 : 2);
    return (items || []).slice().sort((a, b) => typeScore(a.type) - typeScore(b.type));
  }

  // 标题分段（title-parser.js splitTitleSegments——v14.16.0 O8 逐字对齐扩展：
  // 括号/书名号剥离 + |、带空格连字符、×•· 与冒号拆分）
  function splitTitleSegments(rawName) {
    if (!rawName) return [];
    if (typeof rawName !== 'string') rawName = String(rawName); // v10.9：边界防御
    const name = rawName
      .trim()
      .replace(/[\(\[\【].*?[\)\]\】]/g, '')
      .replace(/[《》]/g, '');
    return name
      .split(/[|]+|\s+[-–—]\s+|[×•·]|[:：]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 1);
  }

  // 纯噪声段判定（title-parser.js isPureNoise——O8 逐字对齐）
  function isPureNoise(text) {
    const stripped = text.replace(noiseAllRe, '').replace(/[\s\|\-:：、]+/g, '');
    return stripped.length === 0;
  }

  function parseGameTitle(rawName) {
    if (!rawName) return [];
    const rawParts = splitTitleSegments(rawName);
    const candidates = [];
    const seen = new Set();
    const addCandidate = (text) => {
      const t = String(text || '')
        .trim()
        .replace(/\s+/g, ' ');
      if (t.length >= 2 && !seen.has(t.toLowerCase())) {
        seen.add(t.toLowerCase());
        candidates.push(t);
      }
    };
    for (const part of rawParts) {
      if (isPureNoise(part)) continue; // 纯噪声段（O8 对齐扩展 isPureNoise）
      if (/\bDLC\b|Build[.\s]*\d+|^V?\d+\.\d+/.test(part)) continue; // 版本/DLC 段跳过
      const cleaned = part.replace(noiseAllRe, ' ').replace(/\s+/g, ' ').trim();
      if (cleaned.length >= 2) addCandidate(cleaned);
      const en = part.match(/[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ0-9\s':&.!\-]+[A-Za-zÀ-ɏ0-9'.!]?/g);
      if (en) {
        for (const m of en) {
          const c = m
            .replace(noiseAllRe, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/[:：\s\-]+$/g, '');
          if (c.length >= 2) addCandidate(c);
        }
      }
      const cn = part.match(/[\u4e00-\u9fff\u3400-\u4dbf][\u4e00-\u9fff\u3400-\u4dbf0-9\s:：!！]+/g);
      if (cn) {
        for (const m of cn) {
          const c = m.replace(noiseAllRe, ' ').replace(/\s+/g, ' ').trim();
          if (c.length >= 2) addCandidate(c);
        }
      }
    }
    if (candidates.length === 0) {
      const fallback = rawParts.join(' ').replace(noiseAllRe, ' ').replace(/\s+/g, ' ').trim();
      const strippedFallback = fallback.replace(/[\s|\-:：、]+/g, '');
      if (strippedFallback.length >= 2) addCandidate(fallback);
    }
    const filtered = candidates.filter((c) => !junkCandidateRe.test(c.trim()));
    const finalCandidates = filtered.length > 0 ? filtered : candidates;
    return finalCandidates.slice(0, 5);
  }

  // 新发售判定（orchestrator-shared.js isNewReleaseDate 逐字）
  function isNewReleaseDate(dateStr, withinDays) {
    const days = withinDays || NEW_RELEASE_WINDOW_DAYS;
    const m = String(dateStr || '').match(/(\d{4})\D{1,3}(\d{1,2})(?:\D{1,3}(\d{1,2}))?/);
    if (!m) return false;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3] || 1));
    if (isNaN(d.getTime())) return false;
    const now = Date.now();
    return now >= d.getTime() - 24 * 3600e3 && now - d.getTime() <= days * 24 * 3600e3;
  }

  // ============ v14.29.0 同步：匹配置信度（match-confidence.js 移植子集） ============
  // 平台识别子系统未移植（与扩展的有意差异——平台门恒视为 PC 通过）；标题
  // 相似度与年份门逐字对齐扩展口径（TITLE_SIMILARITY_THRESHOLD = 0.75，
  // 序号护栏/包含/Dice 复合相似度；年份一侧缺失不降级，相差 >1 年才降级）。
  // Match-confidence subset: title/year gates verbatim; the platform gate is
  // treated as passed (platform-detect subsystem not ported — divergence).
  const TITLE_SIMILARITY_THRESHOLD = 0.75;
  const MATCH_SOURCE_LABELS = {
    correction: '用户报错纠正记录',
    index: '名称索引缓存',
    search: 'Steam 商店搜索',
    url: '详情页网址索引',
    image: '页面封面图 appId'
  };
  // 发行年份（match-confidence.js yearOfDateString 逐字）
  function yearOfDateString(value) {
    const m = String(value || '').match(/(\d{4})/);
    if (!m) return null;
    const y = Number(m[1]);
    return y >= 1970 && y <= 2100 ? y : null;
  }
  // 页面标题独立段年份（extractTitleYear 语义对齐：仅接受被分隔符包住的 4 位
  // 年份。实现用 String.match 而非正则 .exec 循环——行为等价（g 标志下两者
  // 同为非重叠扫描、捕获组经段内二次 match 提取），且避开静态污点模型对
  // ".exec(" 的命令注入 sink 撞名误标（Mimosa L3 commit 门）。
  // String.match form (behaviorally identical to the extension's regex-exec
  // loop) — avoids the ".exec(" sink-name collision in the static taint model.
  function extractTitleYear(rawTitle) {
    const text = String(rawTitle || '');
    const segs = text.match(/(?:^|[|丨，,、/\\\s(（\[【])((?:19|20)\d{2})(?=$|[|丨，,、/\\\s)）\]】])/g) || [];
    for (const seg of segs) {
      const m = seg.match(/(?:19|20)\d{2}/);
      if (!m) continue;
      const y = Number(m[0]);
      if (y >= 1990 && y <= 2035) return y;
    }
    return null;
  }
  // 页面标题身份段（pageTitleCores 逐字：按 | / 带空格连字符切段，逐段去
  // 年份/版本号/平台尾词/语言标签——下载站常并列中英官方名，逐段比对）
  function pageTitleCores(rawTitle) {
    const parts = String(rawTitle || '')
      .split(/[|丨/／]+|\s+[-–—]\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    /** @type {string[]} */
    const out = [];
    for (const part of parts) {
      let text = part;
      const year = extractTitleYear(text);
      if (year !== null) text = text.replace(String(year), ' ');
      text = text.replace(/\bv\d+(?:\.\d+)+\b/gi, ' ').replace(/\b\d+\.\d+(?:\.\d+)+\b/g, ' ');
      if (!/[\u4e00-\u9fff]/.test(text)) text = trimPlatformTokens(text) || text;
      text = text.replace(/(?:官方中文|简体中文|繁体中文|中文版|汉化版|汉化|中文|官中)\s*$/, '').trim();
      text = text.replace(/\s{2,}/g, ' ').trim();
      if (text) out.push(text);
    }
    return out;
  }
  // 英文名尾词平台剥离（platform-detect.js trimPlatformTokens 逐字）
  const EN_PLATFORM_TAIL_TOKENS = new Set([
    'switch',
    'switch2',
    'nswitch',
    'ns',
    'ns2',
    'nsp',
    'xci',
    'nsz',
    'nro',
    'rom',
    'roms',
    'wii',
    'wiiu',
    'ps5',
    'ps4',
    'ps3',
    'ps2',
    'ps1',
    'psp',
    'psv',
    'psvita',
    'vita',
    'playstation',
    'nintendo',
    'xbox',
    'xboxone',
    'xbox360',
    'xsx',
    'xss',
    'seriesx',
    'one',
    'emulator',
    'yuzu',
    'ryujinx',
    'sudachi',
    'citron',
    'eden',
    'skyline',
    'dolphin',
    'cemu',
    'citra',
    'pcsx2',
    'pcsx',
    'rpcs3',
    'ppsspp',
    'vita3k',
    'xenia',
    'xemu',
    'mame',
    'winlator',
    'eggns',
    'pc',
    'steam'
  ]);
  function trimPlatformTokens(enName) {
    const raw = String(enName || '').trim();
    const words = raw.split(/[^A-Za-z0-9]+/).filter(Boolean);
    while (words.length > 1 && EN_PLATFORM_TAIL_TOKENS.has(words[words.length - 1].toLowerCase())) {
      words.pop();
    }
    return words.join(' ') || raw;
  }
  // 单段相似度（pairSimilarity 逐字：全等 → 序号护栏 → 包含 → CJK Dice → 拉丁词元 Dice）
  function matchNormTitle(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[\s\-_:：|.'!！?？\[\]()（）×•·™®©]/g, '');
  }
  function matchLatinTokens(s) {
    return new Set(
      String(s || '')
        .toLowerCase()
        .match(/[a-z0-9]+/g) || []
    );
  }
  function pairSimilarity(resultName, core) {
    const rn = matchNormTitle(resultName);
    const cn = matchNormTitle(core);
    if (!rn || !cn || rn.length < 2 || cn.length < 2) return 0;
    if (rn === cn) return 1;
    const nums = (s) => new Set(String(s).match(/\d+/g) || []);
    const rNums = nums(resultName);
    const cNums = nums(core);
    if (cNums.size > 0) {
      for (const n of rNums) if (!cNums.has(n)) return 0.4;
      if (rNums.size === 0) return 0.6;
    } else if (rNums.size > 0) {
      return 0.6;
    }
    let best = 0;
    if (rn.includes(cn)) best = Math.min(1, 0.9 + 0.1 * (cn.length / rn.length));
    else if (cn.includes(rn)) best = Math.min(1, 0.9 + 0.1 * (rn.length / cn.length));
    if (best >= TITLE_SIMILARITY_THRESHOLD) return best;
    const dice = cjkBigramDice(resultName, core);
    if (dice > best) best = dice;
    if (best >= TITLE_SIMILARITY_THRESHOLD) return best;
    const A = matchLatinTokens(resultName);
    const B = matchLatinTokens(core);
    if (A.size > 0 && B.size > 0) {
      let shared = 0;
      for (const t of A) if (B.has(t)) shared++;
      const tokenDice = (2 * shared) / (A.size + B.size);
      if (tokenDice > best) best = tokenDice;
    }
    return best;
  }
  // 标题相似度（titleSimilarity 逐字：各身份段最大值）
  function titleSimilarity(resultName, gameName) {
    let best = 0;
    for (const core of pageTitleCores(gameName)) {
      const s = pairSimilarity(resultName, core);
      if (s > best) best = s;
    }
    return Math.round(best * 100) / 100;
  }
  // 置信度打标（rateMatchConfidence 移植子集：纠正强制 confirmed → 标题主
  // 门 → 年份门；平台门省略——见文件头差异说明）
  function rateMatchConfidenceLite(input) {
    const gameName = String(input.gameName || '');
    const resultName = String(input.resultName || '');
    const sourceKey = MATCH_SOURCE_LABELS[input.source] ? String(input.source) : 'unknown';
    const sourceLabel = MATCH_SOURCE_LABELS[sourceKey] || '未知来源';
    const pageYear = extractTitleYear(gameName);
    const steamYear = yearOfDateString(input.releaseDate || '');
    const similarity = resultName ? titleSimilarity(resultName, gameName) : 0;
    const base = { resultName, sourceLabel, similarity };
    const suspected = (text) => ({ ...base, confidence: 'suspected', reasonText: text });
    // 纠正来源强制 confirmed：用户手动确认优先于自动相似度/年份判定
    if (sourceKey === 'correction') {
      return { ...base, confidence: 'confirmed', reasonText: '用户已确认的映射（人工纠正记录）' };
    }
    if (!resultName) return suspected('Steam 结果未返回标题，无法核对');
    if (similarity < TITLE_SIMILARITY_THRESHOLD) return suspected('匹配标题与页面标题相似度不足');
    if (pageYear !== null && steamYear !== null && Math.abs(pageYear - steamYear) > 1) {
      return suspected('页面年份与 Steam 发行年份相差超过 1 年');
    }
    const reasonText =
      pageYear !== null && steamYear !== null ? '标题一致，发行年份相符' : '标题一致；发行年份仅一侧可知（不降级）';
    return { ...base, confidence: 'confirmed', reasonText };
  }
  // 置信度挂载（orchestrator-list attachMatch 语义：结果对象携带四字段）
  function attachMatchConfidence(target, gameName, resultName, source) {
    if (!target || typeof target !== 'object') return target;
    if (target.matchConflict) return target; // 冲突标记已强制推测，不覆盖
    const m = rateMatchConfidenceLite({
      gameName,
      resultName: resultName || target.name || '',
      releaseDate: target.releaseDate || '',
      source: source || ''
    });
    target.matchConfidence = m.confidence;
    target.matchName = m.resultName;
    target.matchSource = m.sourceLabel;
    target.matchNote = m.reasonText;
    return target;
  }
  // ==================================================================
  // §2 存储层（扩展 steam-cache/name-index/wrong-reports/url-index 的 GM 形态）
  // Storage layer: TTL caches + indexes, bounded with LRU-ish compaction.
  // ==================================================================
  const cacheKeys = {
    rating: (id) => 'rating:' + id,
    urlIndex: (u) => 'url:' + u,
    nameIndex: (n) => 'name:' + n,
    manual: (n) => 'manual:' + n
  };
  // 信封：{v:1, ts, ttl, d}；过期读出 null 并删除
  function cacheGet(kind, key) {
    const entry = gmStore.get(cacheKeys[kind](key), null);
    if (!entry || typeof entry !== 'object') return null;
    if (entry.ts && entry.ttl && Date.now() - entry.ts > entry.ttl) {
      gmStore.del(cacheKeys[kind](key));
      return null;
    }
    return entry;
  }
  function cacheSet(kind, key, data, ttl) {
    evictIfNeeded(kind);
    gmStore.set(cacheKeys[kind](key), { v: 1, ts: Date.now(), ttl, d: data });
  }
  // 有界压缩：超上限时按 ts 淘汰最旧（evictOldestByTs 语义）
  function evictIfNeeded(kind) {
    const prefix = { rating: 'rating:', urlIndex: 'url:', nameIndex: 'name:', manual: 'manual:' }[kind];
    const cap = CACHE_CAPS[kind];
    const keys = gmStore.keys().filter((k) => k.indexOf(prefix) === 0);
    if (keys.length < cap) return;
    const entries = keys.map((k) => ({ k, ts: (gmStore.get(k, null) || {}).ts || 0 })).sort((a, b) => a.ts - b.ts);
    const excess = keys.length - cap + 1;
    for (let i = 0; i < excess && i < entries.length; i++) gmStore.del(entries[i].k);
  }

  // --- 名称索引（name-index.js 语义：appId + missCount 分级负缓存） ---
  function nameIndexGet(gameName) {
    const e = cacheGet('nameIndex', gameName);
    if (!e) return null;
    return e.d; // {appId: string|null, lastSearched, missCount?}
  }
  function negativeTtlFor(missCount) {
    // 分级退避阶梯（NEG_TIER_DIVISORS）：cap/8=15min → cap/2=1h → cap=2h 封顶
    const cap = TTL.negativeCapMs;
    const tier = !missCount || missCount <= 1 ? 0 : missCount === 2 ? 1 : 2;
    return cap / NEG_TIER_DIVISORS[tier];
  }
  function isRecentlySearchedNotFound(gameName) {
    const e = nameIndexGet(gameName);
    if (!e || e.appId !== null) return false;
    return Date.now() - e.lastSearched < negativeTtlFor(e.missCount);
  }
  function recordNameIndex(gameName, appId) {
    const prev = nameIndexGet(gameName);
    const missCount = appId === null ? ((prev && prev.missCount) || 0) + 1 : 0;
    cacheSet(
      'nameIndex',
      gameName,
      { appId: appId === null ? null : String(appId), lastSearched: Date.now(), missCount },
      TTL.metaMs
    );
  }
  function deleteNameIndexEntry(gameName) {
    gmStore.del(cacheKeys.nameIndex(gameName));
  }

  // --- 人工纠正映射（wrong-reports + SAVE_MANUAL_MAPPING 语义） ---
  function lookupCorrection(gameName) {
    const e = cacheGet('manual', gameName);
    if (!e) return null;
    return e.d; // {correctAppId, wrongAppId, ts}
  }
  function saveCorrection(gameName, correctAppId, wrongAppId) {
    cacheSet(
      'manual',
      gameName,
      { correctAppId: String(correctAppId), wrongAppId: wrongAppId ? String(wrongAppId) : null, ts: Date.now() },
      0
    ); // ttl 0 = 永久
  }
  // ttl=0 表示不过期：cacheGet 的过期分支要求 entry.ttl 真值——ttl 0 直接放行 ✓

  // --- URL → appId 索引（url-index 语义：同 URL=同游戏；v14.29.0 起生产写入
  // 全部走 urlIndexSetArbitrated 仲裁——盲写原语已删除） ---
  function urlIndexGet(pageUrl) {
    const e = cacheGet('urlIndex', pageUrl);
    return e ? e.d : null; // {appId, name, ts, titleHash?}
  }

  // --- v14.29.0 同步：URL 索引仲裁写入 + 同站冲突防线 ---
  // （url-index.js setUrlAppIdArbitrated / findHostUrlConflict + steam/
  // match-conflicts.js claimOrDetectMatch 移植。逻辑不变式：同站点两个不同
  // 页面在逻辑上至多一侧指向同一款游戏——两页标题检索命中同一 appId 时
  // 至少一侧错配（扩展实证：xianyudanji.gg/107968.html 与 /107966.html）。
  // 三条防线：①推测级不覆盖已有不同绑定（防漂移钉死）；②同站冲突拒写
  // （不固化第二侧）；③同标题转载豁免（DJB2 标题哈希相同 = 同游戏重发）。
  // Arbirated URL-index writes + host-conflict guards, ported from the
  // extension's v14.29.0 match-conflict defenses.）
  function gameKeyOf(name) {
    const s = String(name || '');
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(36).slice(-6).padStart(6, '0');
  }
  function normalizePageUrl(url) {
    try {
      const u = new URL(url, location.href);
      return u.origin + u.pathname;
    } catch {
      return String(url || '');
    }
  }
  function hostOfUrl(url) {
    try {
      return new URL(String(url || '')).hostname.toLowerCase();
    } catch {
      return '';
    }
  }
  function urlIndexEntries() {
    return gmStore
      .keys()
      .filter((k) => k.indexOf('url:') === 0)
      .map((k) => {
        const raw = gmStore.get(k, null);
        return { url: k.slice(4), d: raw && typeof raw === 'object' ? raw.d : null };
      })
      .filter((e) => e.d && e.d.appId);
  }
  // 同站冲突检测：同 host 另一页已绑定同一 appId → 返回该页（同标题哈希豁免；
  // 旧条目无哈希保守参与）
  function urlIndexFindHostConflict(pageUrl, appId, titleHash) {
    const key = normalizePageUrl(pageUrl);
    const host = hostOfUrl(key);
    if (!key || !host || appId === null || appId === undefined) return null;
    for (const e of urlIndexEntries()) {
      if (e.url === key) continue;
      if (hostOfUrl(e.url) !== host) continue; // 跨站同 appId = 同游戏多站收录，正常
      if (String(e.d.appId) !== String(appId)) continue;
      const otherHash = e.d.titleHash || '';
      if (titleHash && otherHash && otherHash === String(titleHash)) continue;
      return { url: e.url };
    }
    return null;
  }
  // 仲裁写入：同一绑定刷新；推测级不换绑；冲突拒写；确认级（人工确认/封面
  // 直取）才允许换绑。返回 {written, reason} 供调用方留证。
  function urlIndexSetArbitrated(pageUrl, appId, name, opts) {
    const o = opts || {};
    const key = normalizePageUrl(pageUrl);
    if (!key || appId === null || appId === undefined) return { written: false, reason: 'invalid' };
    const prev = urlIndexGet(key);
    const prevAppId = prev && prev.appId ? String(prev.appId) : null;
    const hash = String(o.titleHash || '');
    if (prevAppId && prevAppId === String(appId)) {
      cacheSet(
        'urlIndex',
        key,
        {
          appId: String(appId),
          name: name || (prev && prev.name) || '',
          ts: Date.now(),
          titleHash: hash || (prev && prev.titleHash) || ''
        },
        TTL.metaMs
      );
      return { written: true, reason: 'refresh' };
    }
    if (prevAppId && o.confidence !== 'confirmed') {
      return { written: false, reason: 'suspected-keep', existingAppId: prevAppId };
    }
    const conflict = urlIndexFindHostConflict(key, appId, hash);
    if (conflict) return { written: false, reason: 'host-conflict', existingUrl: conflict.url };
    cacheSet('urlIndex', key, { appId: String(appId), name: name || '', ts: Date.now(), titleHash: hash }, TTL.metaMs);
    return { written: true, reason: prevAppId ? 'confirmed-overwrite' : 'fresh' };
  }
  // 会话级冲突声明表（match-conflicts.js 移植：持久索引尚未落盘的同批场景；
  // GM 存储同步读写 → 同步实现）。TTL 10 分钟、容量 200 有界。
  const CLAIM_TTL_MS = 10 * 60 * 1000;
  const CLAIM_MAX = 200;
  const matchClaims = new Map();
  function claimOrDetectMatch(gameName, pageUrl, appId) {
    if (!pageUrl || appId === null || appId === undefined) return null;
    const key = normalizePageUrl(pageUrl);
    const host = hostOfUrl(key);
    if (!key || !host) return null;
    const hash = gameKeyOf(gameName);
    const now = Date.now();
    // 1) 持久层：URL 索引同站另一页已绑定同一 appId
    const persisted = urlIndexFindHostConflict(key, appId, hash);
    if (persisted) return { source: 'url-index', existingUrl: persisted.url };
    // 2) 会话层：近期声明中同一 (host, appId) 被不同页、不同标题占用
    for (const [k, c] of matchClaims) {
      if (now - c.at > CLAIM_TTL_MS) matchClaims.delete(k);
    }
    for (const [k, c] of matchClaims) {
      const sep = k.indexOf('|');
      if (k.slice(0, sep) === host && k.slice(sep + 1) === String(appId) && c.url !== key && c.hash !== hash) {
        return { source: 'session', existingUrl: c.url };
      }
    }
    // 3) 无冲突 → 记录声明（供同批后续页面检测；超容量淘汰最旧）
    matchClaims.set(host + '|' + String(appId), { name: String(gameName || ''), url: key, hash, at: now });
    if (matchClaims.size > CLAIM_MAX) {
      const oldest = matchClaims.keys().next().value;
      if (oldest !== undefined) matchClaims.delete(oldest);
    }
    return null;
  }
  // 冲突降级标记（orchestrator-list attachMatch conflictReason 语义：强制
  // 「推测」+ 悬停依据；matchConflict 标记同时驱动跳写名称索引）
  const HOST_CONFLICT_NOTE = '同站点另一页面已命中同一游戏，至少一侧匹配可能有误';
  function forceConflictMarkers(target) {
    if (!target || typeof target !== 'object') return target;
    target.matchConfidence = 'suspected';
    target.matchConflict = true;
    target.matchNote = HOST_CONFLICT_NOTE;
    return target;
  }

  // --- 评分缓存（steam-cache rating 模块语义：数据 + 冷却戳 + 失败计数） ---
  function ratingCacheGet(appId) {
    const e = cacheGet('rating', appId);
    return e ? e.d : null; // {appId, name, ..., ratingRetriedAt, ratingFailCount}
  }
  function ratingCacheSet(appId, data) {
    cacheSet('rating', appId, data, TTL.ratingMs);
  }

  // 评分重取判定（api-reviews.js needsRatingRefetch 移植：5min/1h 双冷却）
  function needsRatingRefetch(d) {
    if (!d) return true;
    if (d.positiveRate !== null && d.positiveRate !== undefined) return false;
    const failCount = d.ratingFailCount || 0;
    if (failCount >= RATING_FAIL_RETRY_CAP) {
      return !!d.ratingRetriedAt && Date.now() - d.ratingRetriedAt >= RATING_RETRY_LONG_COOLDOWN_MS;
    }
    return !d.ratingRetriedAt || Date.now() - d.ratingRetriedAt >= RATING_RETRY_COOLDOWN_MS;
  }
  // ==================================================================
  // §3 匹配管线（orchestrator-detail searchAppIdFlow + api-search
  // searchSteamAppIdOnce 移植：全词扫描全局最优 + 跨词共识 + 404 终态）
  // Matching pipeline: all-terms scan, cross-term consensus, 404-as-empty.
  // ==================================================================
  const CONFIDENT_SCORE = 6; // 高确信提前退出（≥6 = 两英文词覆盖）
  const CONSENSUS_BONUS_PER_TERM = 2; // 共识加成每词 +2（封顶 4）
  const CONSENSUS_MAX_TERMS = 3;

  // 商店检索（404 = 终态空结果；两次尝试均失败抛错供外层重试）
  async function storeSearch(term, lang) {
    let data = null;
    for (let attempt = 0; attempt < 2 && data === null; attempt++) {
      try {
        const resp = await gmFetch(
          ENDPOINTS.steamSearch + '?term=' + encodeURIComponent(term) + '&l=' + (lang || 'schinese') + '&cc=cn'
        );
        if (resp.status === 404) {
          return { total: 0, items: [] }; // 终态空（负缓存可固化）
        }
        if (!resp.ok) continue;
        data = resp.json;
      } catch {
        /* 中文搜索失败不阻断流程（重试一次后抛） */
      }
    }
    if (!data) throw new Error('Steam 搜索网络失败');
    return data;
  }

  // 社区英文搜索（steamcommunity SearchApps：免 key 仅英文，404=空结果）
  async function communitySearch(term) {
    try {
      const resp = await gmFetch(ENDPOINTS.communitySearch + encodeURIComponent(term));
      if (resp.status === 404) return [];
      if (!resp.ok || !resp.json) return [];
      const items = (resp.json || []).map((i) => ({
        id: i.appid,
        name: i.name,
        type: 'game'
      }));
      return items;
    } catch {
      return []; // 兜底层失败不影响主流程
    }
  }

  /**
   * 单轮搜索（api-search.js searchSteamAppIdOnce 移植）：全词扫描取全局最优，
   * 跨词共识加成，混合标题 CJK 早退需候选覆盖 ≥2 标题 EN 词。
   * @returns {Promise<{appId: string, name: string, englishName: string}|null>}
   */
  async function searchOnce(searchTerms, rawName, excludeAppId, lang) {
    let globalBest = null;
    const termHits = new Map(); // appId → {appId, name, score, terms}
    const enSeg = (String(rawName).match(/[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ0-9 &:.'\-]{5,}/) || [''])[0].trim();
    const mixedTitle = enSeg.length > 0;
    const enWords = mixedTitle ? coreTokensOf(enSeg).filter((w) => /^[a-z]/.test(w)) : [];
    const hasEnCoverage = (name) => enWords.filter((w) => coreTokensOf(name).includes(w)).length >= 2;

    for (const term of searchTerms) {
      let cnData = null;
      try {
        cnData = await storeSearch(term, lang);
      } catch {
        throw new Error('Steam 搜索网络失败'); // 供外层重试
      }
      const cnItems = (cnData && cnData.items) || [];
      if (cnItems.length === 0) continue;
      const typeRanked = rankCandidatesByType(cnItems);
      const related = typeRanked
        .filter(
          (i) =>
            String(i.id) !== String(excludeAppId || '') &&
            !addonNameRe.test(i.name || '') &&
            !demoNameRe.test(i.name || '') &&
            !isCrossoverEntry(i.name, term, rawName) &&
            nameMatchesSearch(i.name, term, rawName)
        )
        .map((i) => ({ item: i, score: matchCandidateScore(i.name, term, rawName) }))
        .sort((a, b) => b.score - a.score);
      const best = related[0];
      if (!best || best.score < 1) continue;
      const idStr = String(best.item.id);
      if (mixedTitle && lang === 'schinese' && best.score >= CONFIDENT_SCORE && !hasEnCoverage(best.item.name)) {
        // 混合标题下 CJK 候选高分早退护栏：需覆盖 ≥2 个标题 EN 词
        //（防 Dead Space 2 的泛化 EN 覆盖压过 CJK 精准命中）
        if (enWords.length >= 2) continue;
      }
      const prev = termHits.get(idStr);
      const prevTerms = (prev && prev.terms) || 0;
      termHits.set(idStr, {
        appId: idStr,
        name: best.item.name,
        score: best.score,
        terms: prevTerms + 1
      });
      if (!globalBest || best.score > globalBest.score) {
        globalBest = { appId: idStr, name: best.item.name, score: best.score, terms: prevTerms + 1 };
      }
      if (best.score >= CONFIDENT_SCORE) {
        // 高确信提前退出（共识语义保持：置信退出不受共识影响）
        break;
      }
    }
    if (!globalBest) return null;
    // 终选：跨词共识加成（每多一词 +2 封顶 +4）
    const hit = termHits.get(globalBest.appId);
    const consensusTerms = hit ? hit.terms : 1;
    const consensusBonus = Math.min(
      (consensusTerms - 1) * CONSENSUS_BONUS_PER_TERM,
      (CONSENSUS_MAX_TERMS - 1) * CONSENSUS_BONUS_PER_TERM
    );
    return {
      appId: globalBest.appId,
      name: globalBest.name,
      englishName: globalBest.name,
      score: globalBest.score + consensusBonus
    };
  }

  // DLC → 本体解析（orchestrator-detail fetchDetailsResolveDlc 移植）
  async function resolveDlcToBase(appId) {
    const r = await fetchAppDetails(appId);
    if (!r) return { appId: String(appId), type: null };
    if (r.type === 'dlc' && r.fullgame && r.fullgame.appid && String(r.fullgame.appid) !== String(appId)) {
      return { appId: String(r.fullgame.appid), type: 'dlc', dlcName: r.name || '' };
    }
    return { appId: String(appId), type: r.type || null };
  }

  // appdetails basic（meta：官方名/类型/release_date/fullgame）
  async function fetchAppDetails(appId) {
    try {
      const resp = await gmFetch(
        ENDPOINTS.steamAppDetails + '?appids=' + encodeURIComponent(appId) + '&l=schinese&filters=basic'
      );
      if (resp.status === 404) return null;
      if (!resp.ok || !resp.json) return null;
      const payload = resp.json[String(appId)];
      if (!payload || !payload.success || !payload.data) return null;
      return payload.data;
    } catch {
      return null;
    }
  }

  /**
   * 完整解析（orchestrator-detail searchSteamGame 用户侧语义）：
   * 元素直取+DLC → 人工纠正 → 名称索引（含负缓存）→ 搜索流（含 EN 兜底）。
   * @returns {Promise<{appId: string, name: string, englishName: string, source: string}|null>}
   */
  async function resolveGame(gameName, options) {
    const o = options || {};
    let appId = null;
    let excludeAppId = null;
    let resolved = null;
    let dlcCollapsed = false; // v14.29.0：资料片→本体折叠（同站冲突豁免依据）
    let hadNetworkError = false; // v14.29.0：故障三态——网络故障 ≠ 未找到

    // Phase 0：元素直取 appId + DLC 解析（内容侧封面 Steam CDN appId）
    if (o.appId) {
      const base = await resolveDlcToBase(String(o.appId));
      if (base.appId) appId = base.appId;
      if (appId && String(appId) !== String(o.appId)) dlcCollapsed = true;
    }

    // Phase 1.5：人工纠正知识库优先（该标题曾手动确认 → 用户确认 > 自动）
    const correction = lookupCorrection(gameName);
    if (correction && correction.correctAppId) {
      appId = correction.correctAppId;
      excludeAppId = correction.wrongAppId;
      deleteNameIndexEntry(gameName);
      return {
        appId,
        name: '',
        englishName: '',
        source: 'correction',
        excludeAppId,
        dlcCollapsed,
        // v14.29.0：纠正来源强制 confirmed（用户手动确认优先于自动判定）
        matchConfidence: 'confirmed',
        matchName: gameName,
        matchSource: MATCH_SOURCE_LABELS.correction,
        matchNote: '用户已确认的映射（人工纠正记录）'
      };
    }

    // Phase 1：名称索引命中（粘性条目）
    if (!appId) {
      const idx = nameIndexGet(gameName);
      if (idx && idx.appId) appId = idx.appId;
    }

    // Phase 3：无 appId → 负缓存守卫（v10.9.2 ignoreNegativeCache 穿透语义）
    if (!appId && !o.ignoreNegativeCache && isRecentlySearchedNotFound(gameName)) {
      return null; // 静默未找到（负缓存期内）
    }

    // Phase 4：搜索流（目录离线索引为扩展专属 GM 形态不支持 → 在线管线）
    if (!appId) {
      const terms = parseGameTitle(gameName);
      if (terms.length === 0) return null;
      let found = null;
      try {
        found = await searchOnce(terms, o.rawTitle || gameName, excludeAppId, 'schinese');
      } catch {
        found = null;
        hadNetworkError = true; // v14.29.0：传输层失败留证（三态判定）
      }
      // 阶段 3 兜底：英文段重搜（l=english）+ 社区英文端点
      if (!found) {
        const enSeg = (String(o.rawTitle || gameName).match(/[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ0-9 &:.'\-]{5,}/) || [''])[0].trim();
        if (enSeg) {
          try {
            found = await searchOnce([enSeg], o.rawTitle || gameName, excludeAppId, 'english');
          } catch {
            found = null;
            hadNetworkError = true;
          }
          if (!found) {
            const cItems = await communitySearch(enSeg);
            const rel = cItems
              .filter((i) => nameMatchesSearch(i.name, enSeg, o.rawTitle || gameName))
              .map((i) => ({ i, s: matchCandidateScore(i.name, enSeg, o.rawTitle || gameName) }))
              .sort((a, b) => b.s - a.s);
            if (rel[0] && rel[0].s >= 1)
              found = { appId: String(rel[0].i.id), name: rel[0].i.name, englishName: rel[0].i.name };
          }
        }
      }
      if (!found) {
        // v14.29.0：网络故障 ≠ 未找到——不固化负缓存，返回三态哨兵（内容侧
        // 渲染「网络异常」而非「未找到」；v14.28.8 故障语义分离同源）
        if (hadNetworkError) {
          return { networkFailed: true };
        }
        // 负缓存固化守卫：窗口内任一成功（total>failed）才允许（v9.7.0 语义）
        const w = domainWindow.store;
        const total = w.length;
        const failed = total - w.reduce((a, b) => a + b, 0);
        if (failed === 0 || total > failed) {
          recordNameIndex(gameName, null);
        }
        return null;
      }
      appId = found.appId;
      resolved = found;
    }

    if (!appId) return null;
    return {
      appId: String(appId),
      name: (resolved && resolved.name) || '',
      englishName: (resolved && resolved.englishName) || '',
      source: resolved ? 'search' : 'index',
      excludeAppId,
      dlcCollapsed
    };
  }
  // ==================================================================
  // §4 评分获取（api-reviews.js 商店页三形态回退解析——appreviews 端点已
  // 302 死亡，油猴版直连商店页解析，省一次死请求；扩展口径 v14.8.2）
  // Ratings via store-page HTML fallback (three row forms), direct.
  // ==================================================================
  /**
   * 商店页解析评分（行块制 + 行语义分级，v14.21.0 对齐扩展口径）：Steam
   * 服务端渲染已无"全部评测"行（桌面区块仅"最近评测"+"您语言"两行；
   * responsive 区块"所有评测"实为"您语言"镜像且无 tooltip）——总体行按
   * ① 真·全时段行 ②"您语言"行代位（l=schinese 即官方简体中文全时段摘要）
   * ③ 最近行保底 三级取用；desc 取所用行块内 game_review_summary span。
   * 三形态保留：完整行 tooltip 计数+pct / 低评测行计数无 pct / 无评测行
   * total 0。（顺修旧 tooltip 正则 `[ age]*` 无法跨越 href 属性的错配）
   * @returns {Promise<{total, positive, negative, desc, recent:{total,positive,rate}}|null>}
   */
  async function fetchReviewSummary(appId) {
    try {
      const resp = await gmFetch(ENDPOINTS.steamStoreApp + encodeURIComponent(appId) + '/?l=schinese&cc=cn', {
        timeout: PERF.pageTimeoutMs
      });
      if (!resp.ok || !resp.text) return null;
      const html = resp.text;
      const ROW_BLOCK_RE = /<a[^>]*class="[^"]*user_reviews_summary_row[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
      const rows = [...html.matchAll(ROW_BLOCK_RE)]
        .map((m) => {
          const tip = ((m[0].match(/data-tooltip-html="([^"]+)"/) || [])[1] || '')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
          const descM = m[1].match(
            /game_review_summary\s+(?:positive|mixed|negative|not_enough_reviews)"[^>]*>([^<]+)</
          );
          // 各源仅在真实匹配到时取值（Number('') = 0 会伪造计数）
          const tipCountM = tip.match(/([\d,]+)\s*篇用户评测/);
          const tipCount = tipCountM ? Number(tipCountM[1].replace(/,/g, '')) : NaN;
          const metaM = m[1].match(/itemprop="reviewCount" content="(\d+)"/);
          const meta = metaM ? Number(metaM[1]) : NaN;
          const spanCountM = m[1].match(/([\d,]+)\s*篇用户评测/);
          const spanCount = spanCountM ? Number(spanCountM[1].replace(/,/g, '')) : NaN;
          const tipPctM = tip.match(/有\s*(\d+)%\s*为好评/);
          const tipPct = tipPctM ? Number(tipPctM[1]) : NaN;
          const counts = [tipCount, meta, spanCount].filter((n) => Number.isFinite(n));
          return {
            tip,
            count: counts.length > 0 ? counts[0] : null,
            pct: Number.isFinite(tipPct) ? tipPct : null,
            desc: descM ? descM[1].trim() : null,
            isRecent: tip.indexOf('过去 30 天') >= 0,
            isCn: tip.indexOf('您语言') >= 0
          };
        })
        .filter((r) => r.tip); // responsive 行无 tooltip——排除
      const withCount = rows.filter((r) => r.count != null && r.count > 0);
      const allRow =
        withCount.find((r) => !r.isRecent && !r.isCn && r.pct != null) ||
        withCount.find((r) => r.isCn && !r.isRecent && r.pct != null) ||
        withCount.find((r) => r.pct != null) ||
        null;
      const recentRow = rows.find((r) => r.isRecent && r.pct != null && r.count != null) || null;
      if (allRow && allRow.pct != null) {
        const allCount = allRow.count;
        const allPct = allRow.pct;
        const positive = Math.round((allCount * allPct) / 100);
        const recentTotal = recentRow && recentRow.count != null ? recentRow.count : 0;
        const recentPct = recentRow && recentRow.pct != null ? recentRow.pct : 0;
        return {
          total: allCount,
          positive,
          negative: Math.max(0, allCount - positive),
          rate: allPct, // 直接携带 Steam 官方百分比（免反推舍入）
          desc: allRow.desc,
          recent: {
            total: recentTotal,
            positive: recentRow ? Math.round((recentTotal * recentPct) / 100) : 0,
            rate: recentRow ? recentPct : null
          }
        };
      }
      // 低/零评测形态：tooltip 无 count+pct → 行内 span / meta reviewCount 取计数
      const insufficient = rows.find(
        (r) => !r.isRecent && r.count != null && r.count > 0 && r.tip.indexOf('需要更多用户评测') >= 0
      );
      const zeroRow = rows.find((r) => !r.isRecent && (r.tip.indexOf('无用户评测') >= 0 || r.count === 0));
      if (insufficient) {
        return {
          total: insufficient.count,
          positive: null, // Steam 未出百分比——不伪造（交管线按"暂无整体评价"渲染）
          negative: null,
          desc: '需要更多用户评测来生成整体评价',
          recent: { total: 0, positive: 0, rate: null }
        };
      }
      if (zeroRow) {
        return {
          total: 0,
          positive: 0,
          negative: 0,
          desc: '无用户评测',
          recent: { total: 0, positive: 0, rate: null }
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * 完整评分装配（缓存 → 商店页解析 → 缓存写入含冷却戳）。
   * @returns {Promise<Object|null>} 与扩展 merged 同构（字段子集）
   */
  async function rateGame(appId, hint) {
    const cached = ratingCacheGet(appId);
    if (cached && !needsRatingRefetch(cached)) return cached;
    const summary = await fetchReviewSummary(appId);
    const details = hint && hint.details ? hint.details : await fetchAppDetails(appId);
    const data = {
      appId: String(appId),
      type: (details && details.type) || 'game',
      name: (hint && hint.name) || (details && details.name) || '',
      englishName: (details && details.name) || (hint && hint.name) || '',
      positiveRate: summary
        ? summary.rate != null
          ? summary.rate
          : summary.positive === null
            ? null
            : Math.round((summary.positive * 100) / Math.max(summary.total, 1))
        : null,
      ratingDesc: summary ? summary.desc : null,
      totalReviews: summary ? summary.total : 0,
      positiveReviews: summary ? summary.positive : null,
      negativeReviews: summary ? summary.negative : null,
      recentPositiveRate: summary && summary.recent ? summary.recent.rate : null,
      recentTotalReviews: summary && summary.recent ? summary.recent.total : 0,
      releaseDate: (details && details.release_date && details.release_date.date) || '',
      headerImage: ENDPOINTS.steamCdnHeader(appId),
      comingSoon: !!(details && details.release_date && details.release_date.coming_soon),
      isNewRelease: isNewReleaseDate((details && details.release_date && details.release_date.date) || ''),
      cachedAt: Date.now(),
      // v6.4.10 冷却语义：失败（positiveRate null）→ +1 计数；成功 → 归零
      ratingFailCount:
        summary && summary.positive === null
          ? (cached && cached.ratingFailCount) || 0
          : summary
            ? 0
            : ((cached && cached.ratingFailCount) || 0) + 1,
      ratingRetriedAt: Date.now()
    };
    ratingCacheSet(appId, data);
    return data;
  }
  // ==================================================================
  // §5 UI——徽章（badges/core.js createBadge/prependBadge 移植：组标记
  // gr-rating-badge 防重复守卫 + 低评测提示 + 红标题 + 等待/错误）
  // UI: badge rendering with the gr-rating-badge group-marker guard.
  // ==================================================================
  const CSS =
    '.gr-badge{display:inline-flex;align-items:center;gap:2px;padding:1px 7px;margin:0 6px 0 0;border-radius:10px;' +
    'font-size:12px;line-height:18px;vertical-align:middle;font-family:sans-serif;white-space:nowrap;}' +
    '.gr-badge a{color:inherit;text-decoration:none;}' +
    '.gr-title-red{color:#e0483e !important;}' +
    '.gr-working-badge{opacity:.75;cursor:default;}' +
    '.gr-float{position:fixed;top:76px;width:320px;max-width:86vw;z-index:2147483600;background:#1b2838;color:#c7d5e0;' +
    'border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.4);font:13px/1.6 sans-serif;}' +
    '.gr-float.right{right:16px;left:auto;}' +
    '.gr-float.left{left:16px;}' +
    '.gr-float-head{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;cursor:move;' +
    'background:linear-gradient(90deg,#171a21,#2a475e);border-radius:8px 8px 0 0;font-weight:bold;color:#fff;}' +
    '.gr-float-body{padding:12px 14px;max-height:70vh;overflow-y:auto;}' +
    '.gr-float-folded .gr-float-body{display:none;}' +
    '.gr-row{display:flex;justify-content:space-between;gap:10px;padding:3px 0;border-bottom:1px dashed rgba(255,255,255,.08);}' +
    '.gr-row:last-child{border-bottom:none;}' +
    '.gr-row .k{color:#8f98a0;flex:none;}' +
    '.gr-row .v{text-align:right;word-break:break-all;}' +
    '.gr-cand{display:flex;align-items:center;gap:10px;padding:8px;margin:4px 0;background:rgba(0,0,0,.2);' +
    'border:1px solid #2a475e;border-radius:3px;cursor:pointer;}' +
    '.gr-cand:hover,.gr-cand.active{background:rgba(102,192,244,.25);border-color:#66c0f4;}' +
    '.gr-reason{font-size:11px;color:#e67e22;background:rgba(230,126,34,.08);border:1px solid rgba(230,126,34,.3);' +
    'border-radius:3px;padding:6px 8px;margin-bottom:10px;word-break:break-all;}';

  function injectCss() {
    if (document.getElementById('gr-us-css')) return;
    const style = document.createElement('style');
    style.id = 'gr-us-css';
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  // v14.29.0 安全整改（用户裁决：先整改再提交）：浮窗/候选面板全量
  // createElement 化——innerHTML 字符串拼接退场（零 HTML sink），动态值一律
  // textContent（消毒由 DOM API 结构性保证，不再依赖调用点 esc() 记忆）。
  // 原共享转义函数 esc()（shared/escape.js 语义）随模板退场删除——全脚本
  // 已无 HTML 拼接面。徽章域本就走 createBadge textContent，不受影响。
  // DOM-building helper: dynamic values go through textContent only, so the
  // whole userscript now has no HTML sink at all (structural sanitizer).
  function el(tag, styleText, text) {
    const node = document.createElement(tag);
    if (styleText) node.style.cssText = styleText;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  /** 创建徽章（badge-base.js createBadge 移植：防重复守卫在 prependBadge） */
  function createBadge(link, opts) {
    const badge = document.createElement('span');
    badge.className = 'gr-badge ' + (opts.cls || 'gr-rating-badge') + (opts.working ? ' gr-working-badge' : '');
    badge.style.color = opts.color || '#c7d5e0';
    badge.style.background = opts.bg || 'rgba(42,71,94,.5)';
    if (opts.dashed) badge.style.border = '1px dashed ' + (opts.color || '#666');
    if (opts.title) badge.title = opts.title;
    if (opts.clickable && opts.appId) {
      const a = document.createElement('a');
      a.href = ENDPOINTS.steamStoreApp + opts.appId + '/';
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = opts.text;
      badge.appendChild(a);
      badge.dataset.grAppId = String(opts.appId);
    } else {
      badge.textContent = opts.text;
    }
    if (opts.onClick) {
      badge.style.cursor = 'pointer';
      badge.addEventListener('click', opts.onClick);
    }
    return badge;
  }

  // v14.29.0：动态负缓存提示（name-index negativeCacheRemainingMs 语义——
  // 分级退避 15min→1h→2h 的真实剩余分钟，替代静态文案）
  function negativeCacheHintText(gameName) {
    const e = nameIndexGet(gameName);
    if (!e || e.appId !== null || !e.lastSearched) return '负缓存分级退避 15min→1h→2h 后自动重查';
    const remaining = negativeTtlFor(e.missCount) - (Date.now() - e.lastSearched);
    if (remaining <= 0) return '负缓存已过期，点击立即重查';
    return '约 ' + Math.max(1, Math.ceil(remaining / 60000)) + ' 分钟后自动重查（分级退避）· 点击立即重查';
  }

  // v14.29.0：网络异常徽章（故障三态——传输层失败 ≠ "Steam 无此游戏"；
  // badges/core.js gr-badge-network-error 同语义，点击立即重查）
  function renderNetworkErrorBadge(item) {
    const link = item.link;
    if (!link) return;
    const old = link.querySelector('.gr-rating-badge');
    if (old) old.remove();
    const badge = createBadge(link, {
      text: '⚠️ 网络异常·点击重查',
      color: '#b8860b',
      bg: 'rgba(184,134,11,.12)',
      cls: 'gr-badge-network-error gr-rating-badge',
      title:
        'Steam 网络/限流故障，本次未能完成检索（并非 Steam 无此游戏）\n点击立即重查 · 网络恢复后刷新页面也会自动重试',
      dashed: true,
      onClick: () => retryItem(item)
    });
    link.parentNode.insertBefore(badge, link);
  }

  /**
   * 好评率徽章渲染（badges/core.js prependBadge 移植——段序：综合简化为
   * 总体+近30天；未找到/类型/低评测/正常四形态；v14.29.0 同步推测匹配
   * 琥珀徽章与悬停依据）。
   */
  function renderRatingBadge(item, rating, settings) {
    const link = item.link;
    if (!link) return;
    const old = link.querySelector('.gr-rating-badge');
    if (old) old.remove(); // 就绪快路径同步应用（重渲染覆盖等待徽章）
    const bv = (settings && settings.badgeVisibility) || {};
    const showRecent = bv.recent !== false;
    const showAll = bv.all !== false;
    const isNotFound = !rating || !rating.appId;
    const isTypeBadge = !isNotFound && rating.type && rating.type !== 'game' && rating.type !== 'demo';
    const rate = rating ? rating.positiveRate : null;
    // v14.29.0：推测匹配视觉（badges/core.js SUSPECT_STYLE 同源——琥珀配色 +
    // 前缀「推测」+ 虚线边框；悬停给出依据：冲突说明/匹配标题/来源）
    const suspectedMatch = !!(rating && rating.matchConfidence === 'suspected');
    const suspectTitle = suspectedMatch
      ? '推测匹配（未达确认条件）：' +
        (rating.matchNote || '信息不足，无法核对标题/发行年份') +
        (rating.matchName ? '\n匹配到「' + rating.matchName + '」' : '') +
        (rating.matchSource ? ' · 来源：' + rating.matchSource : '') +
        '\n'
      : '';
    // v14.16.0 O5：同项多徽章 DocumentFragment 单次插入（每项 2-3 次独立 DOM
    // 写 → 1 次；扩展侧 insertBadges 单点同语义）。
    const pendingBadges = [];
    const flushBadges = () => {
      if (!pendingBadges.length) return;
      const frag = document.createDocumentFragment();
      for (const b of pendingBadges) frag.appendChild(b);
      link.parentNode.insertBefore(frag, link);
    };

    if (isNotFound) {
      pendingBadges.push(
        createBadge(link, {
          text: '未找到',
          color: '#666',
          bg: 'rgba(102,102,102,.08)',
          cls: 'gr-badge-notfound gr-rating-badge',
          title: '未在 Steam 找到该游戏\n' + negativeCacheHintText(item.gameName),
          dashed: true,
          onClick: () => retryItem(item)
        })
      );
      flushBadges();
      return;
    }
    if (isTypeBadge) {
      pendingBadges.push(
        createBadge(link, {
          text: rating.type,
          color: '#b48ce0',
          bg: 'rgba(180,140,224,.12)',
          cls: 'gr-badge-type gr-rating-badge',
          title: 'Steam 条目类型: ' + rating.type + '（合集/非单个游戏本体）'
        })
      );
      flushBadges();
      return;
    }
    if (rate === null || rate === undefined) {
      // v14.9.1 低/零评测可见提示：#AppID·新游/未发售/无评测/评测少 + 悬停发售日期
      const relTag = rating.comingSoon
        ? '未发售'
        : rating.isNewRelease
          ? '新游'
          : rating.ratingDesc === '无用户评测'
            ? '无评测'
            : rating.ratingDesc
              ? '评测少'
              : '';
      const relNote = rating.releaseDate ? '，发售于 ' + rating.releaseDate : '';
      pendingBadges.push(
        createBadge(link, {
          text: (suspectedMatch ? '推测 ' : '') + (relTag ? '#' + rating.appId + '·' + relTag : '#' + rating.appId),
          color: suspectedMatch ? '#b8860b' : '#8f98a0',
          bg: suspectedMatch ? 'rgba(184,134,11,.12)' : 'rgba(143,152,160,.15)',
          cls: suspectedMatch ? 'gr-rating-badge gr-badge-suspected' : 'gr-rating-badge',
          dashed: suspectedMatch,
          title:
            suspectTitle +
            'Steam 已匹配 (AppID ' +
            rating.appId +
            ')' +
            relNote +
            '，' +
            (rating.ratingDesc || '暂无评测') +
            '\n点击跳转 Steam 详情页',
          clickable: true,
          appId: rating.appId
        })
      );
      flushBadges();
      return;
    }
    if (showAll) {
      pendingBadges.push(
        createBadge(link, {
          text: (suspectedMatch ? '推测 ' : '') + rate + '%',
          color: suspectedMatch ? '#b8860b' : rate >= 70 ? '#a1cd44' : rate >= 40 ? '#b9a064' : '#bd545d',
          bg: suspectedMatch ? 'rgba(184,134,11,.12)' : 'rgba(42,71,94,.5)',
          cls: suspectedMatch ? 'gr-rating-badge gr-badge-suspected' : 'gr-rating-badge',
          dashed: suspectedMatch,
          title:
            suspectTitle +
            'Steam 好评率 ' +
            rate +
            '%\n' +
            (rating.ratingDesc ? rating.ratingDesc + ' · ' : '') +
            '共 ' +
            Number(rating.totalReviews || 0).toLocaleString('zh-CN') +
            ' 篇评测' +
            '\n点击跳转 Steam 详情页',
          clickable: true,
          appId: rating.appId
        })
      );
    }
    if (showRecent) {
      const rr = rating.recentPositiveRate;
      const rt = rating.recentTotalReviews || 0;
      pendingBadges.push(
        createBadge(link, {
          text: rr === null || rr === undefined ? '—' : rr + '%',
          color: '#66c0f4',
          bg: 'rgba(102,192,244,.1)',
          cls: 'gr-badge-recent',
          title: rr === null || rr === undefined ? '近 30 天无评测' : '近 30 天好评率 ' + rr + '%（' + rt + ' 篇）'
        })
      );
    }
    flushBadges();
    // 红标题（总+近30天 均 > 阈值；红优先于绿——扩展 badges/core.js 同语义）
    const redThreshold = Number(settings && settings.redTitleRating) || 0;
    if (
      redThreshold > 0 &&
      rating.appId &&
      rating.positiveRate != null &&
      rating.recentPositiveRate != null &&
      rating.positiveRate > redThreshold &&
      rating.recentPositiveRate > redThreshold
    ) {
      const titleEl = item.titleEl || (item.element && item.element.querySelector('h2, h3, h4, .title, .entry-title'));
      if (titleEl) titleEl.classList.add('gr-title-red');
    }
  }

  /** 等待徽章（working.js 语义：⏳ 检索中 i/N） */
  function renderWaitingBadge(item, text) {
    const link = item.link;
    if (!link) return;
    let badge = link.querySelector('.gr-working-badge');
    if (!badge) {
      badge = createBadge(link, { text: '', cls: 'gr-rating-badge gr-working-badge', working: true });
      link.parentNode.insertBefore(badge, link);
    }
    badge.textContent = text;
  }

  function removeWaitingBadge(item) {
    const badge = item.link && item.link.querySelector('.gr-working-badge');
    if (badge) badge.remove();
  }

  /** 未找到点击重查（v14.7 批次 3：穿透负缓存单游戏重查） */
  async function retryItem(item) {
    renderWaitingBadge(item, '⏳ 重查中…');
    const resolved = await lookupAndRate(item.gameName, { rawTitle: item.gameName, ignoreNegativeCache: true });
    removeWaitingBadge(item);
    // v14.29.0：故障三态——重查遇网络故障渲染「网络异常」而非「未找到」
    if (resolved && resolved.networkFailed) {
      renderNetworkErrorBadge(item);
      return;
    }
    renderRatingBadge(item, resolved, currentSettings);
  }
  // ==================================================================
  // §6 详情页浮窗（sidebar.js/candidates.js 轻量移植：信息行/无评价原因行/
  // 手动选择键盘导航/30s 自动重查一次）
  // Detail float + manual-select candidates + single-shot auto retry.
  // ==================================================================
  let autoRetryTimer = null;
  const autoRetriedGames = new Set();

  function cancelAutoRetry() {
    if (autoRetryTimer) {
      clearTimeout(autoRetryTimer);
      autoRetryTimer = null;
    }
  }

  /** 详情页标题识别（detail-page detectGameName 简化：h1/og:title） */
  function detectDetailGameName() {
    const h1 = document.querySelector('h1');
    if (h1 && h1.textContent && h1.textContent.trim().length >= 2) return h1.textContent.trim();
    const og = document.querySelector('meta[property="og:title"]');
    if (og && og.content) return String(og.content).trim();
    return document.title.replace(/[-_|].*$/, '').trim();
  }

  /** 详情页元素直取 appId（封面 Steam CDN 信号，限主内容区语义简化为全页） */
  function extractAppIdFromImages() {
    const imgs = document.querySelectorAll('img');
    for (const img of imgs) {
      const src =
        img.getAttribute('data-src') ||
        img.getAttribute('data-lazy-src') ||
        img.getAttribute('data-original') ||
        img.src ||
        '';
      const m = String(src).match(/\/steam\/apps\/(\d+)\//i);
      if (m) return m[1];
    }
    return null;
  }

  /** 完整查改评一次过（resolve → 冲突防线 → rate → 仲裁记录 url 索引） */
  async function lookupAndRate(gameName, opts) {
    const o = opts || {};
    const resolved = await resolveGame(gameName, {
      rawTitle: o.rawTitle,
      appId: o.appId,
      ignoreNegativeCache: o.ignoreNegativeCache
    });
    if (!resolved || !resolved.appId) return resolved || null; // networkFailed 哨兵透传
    // v14.29.0：同站 appId 冲突防线（DLC 折叠豁免——同站"本体页+资料片页"
    // 命中同一 appId 是正确行为）
    let conflict = null;
    if (o.pageUrl && !resolved.dlcCollapsed) {
      conflict = claimOrDetectMatch(gameName, o.pageUrl, resolved.appId);
    }
    if (o.pageUrl && resolved.source !== 'correction') {
      const arb = urlIndexSetArbitrated(o.pageUrl, resolved.appId, resolved.name, {
        confidence: conflict ? 'suspected' : resolved.matchConfidence || null,
        titleHash: gameKeyOf(gameName)
      });
      if (!arb.written && arb.reason === 'host-conflict') {
        conflict = conflict || { source: 'url-index', existingUrl: arb.existingUrl };
      }
    }
    if ((resolved.source === 'correction' || resolved.source === 'index') && !conflict) {
      recordNameIndex(gameName, resolved.appId); // 纠正/索引命中粘性化（冲突条目跳写）
    }
    const data = await rateGame(resolved.appId, { name: resolved.name });
    if (data) {
      attachMatchConfidence(data, gameName, resolved.name, resolved.source);
      if (conflict) forceConflictMarkers(data);
    }
    return data;
  }

  /** 创建/复用浮窗（floats.js 语义简化：折叠 + 拖拽 + 左右位置） */
  function ensureFloat() {
    let float = document.getElementById('gr-us-float');
    if (float) return float;
    float = document.createElement('div');
    float.id = 'gr-us-float';
    float.className = 'gr-float ' + (settings.floatSide === 'right' ? 'right' : 'left');
    const headEl = el('div');
    headEl.className = 'gr-float-head';
    headEl.appendChild(el('span', null, '🎮 Steam 信息'));
    const ops = el('span');
    const foldBtn = el('span', 'cursor:pointer;padding:0 6px;', '▾');
    foldBtn.id = 'gr-us-fold';
    const closeBtn = el('span', 'cursor:pointer;padding:0 6px;', '✕');
    closeBtn.id = 'gr-us-close';
    ops.appendChild(foldBtn);
    ops.appendChild(closeBtn);
    headEl.appendChild(ops);
    const bodyEl = el('div');
    bodyEl.className = 'gr-float-body';
    bodyEl.id = 'gr-us-float-body';
    float.appendChild(headEl);
    float.appendChild(bodyEl);
    document.body.appendChild(float);
    if (!settings.detailFloatExpanded) float.classList.add('gr-float-folded');
    float.querySelector('#gr-us-fold').addEventListener('click', () => float.classList.toggle('gr-float-folded'));
    float.querySelector('#gr-us-close').addEventListener('click', () => float.remove());
    // 拖拽（v11.0 B5 语义简化：位置不持久化）
    const head = float.querySelector('.gr-float-head');
    head.addEventListener('mousedown', (e) => {
      if (e.target.id === 'gr-us-fold' || e.target.id === 'gr-us-close') return;
      const rect = float.getBoundingClientRect();
      const dx = e.clientX - rect.left;
      const dy = e.clientY - rect.top;
      float.style.left = rect.left + 'px';
      float.style.top = rect.top + 'px';
      float.classList.remove('right');
      const move = (ev) => {
        float.style.left = Math.max(0, ev.clientX - dx) + 'px';
        float.style.top = Math.max(0, ev.clientY - dy) + 'px';
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
      e.preventDefault();
    });
    return float;
  }

  function floatBody() {
    return ensureFloat().querySelector('#gr-us-float-body');
  }

  function showFloatLoading(text) {
    const wrap = el('div', 'padding:16px;text-align:center;color:#8f98a0;');
    wrap.appendChild(el('div', 'font-size:24px;margin-bottom:8px;', '🎮'));
    wrap.appendChild(el('div', null, text || '正在查询 Steam 信息...'));
    floatBody().replaceChildren(wrap);
  }

  /**
   * 浮窗数据构建（v14.29.0 安全整改：原 floatHtml/ratingRowsHtml innerHTML
   * 拼接 → createElement 全量——结构与样式逐项等价，动态值全部 textContent）。
   * Build the float body via DOM only (structure/style equivalent to the old
   * escaped innerHTML template).
   */
  function buildFloatBody(d) {
    const frag = document.createDocumentFragment();
    const topWrap = el('div', 'text-align:center;margin-bottom:10px;');
    const link = el('a');
    link.href = ENDPOINTS.steamStoreApp + d.appId + '/';
    link.target = '_blank';
    link.rel = 'noopener';
    const img = el('img');
    img.src = d.headerImage || '';
    img.style.cssText = 'max-width:100%;border-radius:4px;';
    img.onerror = function () {
      this.style.display = 'none';
    };
    link.appendChild(img);
    topWrap.appendChild(link);
    frag.appendChild(topWrap);
    frag.appendChild(
      el('div', 'font-weight:bold;color:#fff;margin-bottom:8px;word-break:break-all;', d.name || d.englishName || '')
    );
    appendRatingRows(frag, d);
    const appRow = el('div');
    appRow.className = 'gr-row';
    const k = el('span');
    k.className = 'k';
    k.textContent = 'AppID';
    const v = el('span');
    v.className = 'v';
    const a = el('a', 'color:#66c0f4;text-decoration:none;');
    a.href = ENDPOINTS.steamStoreApp + d.appId + '/';
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = (d.appId || '') + ' ↗';
    v.appendChild(a);
    appRow.appendChild(k);
    appRow.appendChild(v);
    frag.appendChild(appRow);
    return frag;
  }

  /** 评分行构建（原 ratingRowsHtml：positiveRate null → 灰色原因行） */
  function appendRatingRows(frag, d) {
    const fmt = (n) => Number(n || 0).toLocaleString('zh-CN');
    if (d.positiveRate != null) {
      const row1 = el('div');
      row1.className = 'gr-row';
      const k1 = el('span');
      k1.className = 'k';
      k1.textContent = 'Steam 总体评价';
      const v1 = el('span');
      v1.className = 'v';
      v1.style.color = d.positiveRate >= 70 ? '#a1cd44' : d.positiveRate >= 40 ? '#b9a064' : '#bd545d';
      v1.textContent = (d.ratingDesc || '') + ' ' + d.positiveRate + '%（' + fmt(d.totalReviews) + ' 篇）';
      row1.appendChild(k1);
      row1.appendChild(v1);
      const row2 = el('div');
      row2.className = 'gr-row';
      const k2 = el('span');
      k2.className = 'k';
      k2.textContent = '最近 30 天';
      const v2 = el('span');
      v2.className = 'v';
      v2.textContent =
        d.recentPositiveRate == null ? '—' : d.recentPositiveRate + '%（' + fmt(d.recentTotalReviews) + ' 篇）';
      row2.appendChild(k2);
      row2.appendChild(v2);
      frag.appendChild(row1);
      frag.appendChild(row2);
      return;
    }
    const row = el('div');
    row.className = 'gr-row';
    const k = el('span');
    k.className = 'k';
    k.textContent = 'Steam 总体评价';
    const v = el('span');
    v.className = 'v';
    v.style.color = '#8f98a0';
    v.textContent = (d.ratingDesc || '暂无评测') + (d.totalReviews ? '（' + fmt(d.totalReviews) + ' 篇）' : '');
    row.appendChild(k);
    row.appendChild(v);
    frag.appendChild(row);
    if (d.releaseDate) {
      const rd = el('div');
      rd.className = 'gr-row';
      const rk = el('span');
      rk.className = 'k';
      rk.textContent = '发售日期';
      const rv = el('span');
      rv.className = 'v';
      rv.textContent = d.releaseDate;
      rd.appendChild(rk);
      rd.appendChild(rv);
      frag.appendChild(rd);
    }
  }

  /** 渲染浮窗数据 + 手动选择兜底（renderAndShow 语义） */
  function renderFloat(data) {
    floatBody().replaceChildren(buildFloatBody(data));
  }

  /** 候选手动选择面板（candidates.js 移植：搜索+键盘导航+纠正映射+重试） */
  function renderCandidates(gameName, missReason) {
    const body = floatBody();
    // v14.29.0 安全整改：面板 DOM 全量构建（原 innerHTML 模板退场）
    const titleEl = el('div', 'font-weight:bold;color:#fff;margin-bottom:8px;', '🎮 手动选择游戏');
    const subtitle = el(
      'div',
      'font-size:12px;color:#8f98a0;margin-bottom:12px;',
      '未能自动匹配 Steam 游戏。请从下方候选列表中选择，或输入关键词搜索。'
    );
    body.replaceChildren(titleEl, subtitle);
    if (missReason) {
      const reasonEl = el(
        'div',
        'white-space:pre-line;',
        '⚠️ 未命中原因：' + missReason + '\nSteam 商店接口不可达时请检查网络/加速器；确认游戏在 Steam 后点下方重试。'
      );
      reasonEl.className = 'gr-reason';
      body.appendChild(reasonEl);
    }
    const btnRow = el('div', 'display:flex;gap:8px;margin-bottom:10px;');
    const retryBtn = el(
      'button',
      'flex:1;padding:6px;border:1px solid #2a475e;border-radius:3px;background:#2a475e;color:#c7d5e0;cursor:pointer;',
      '🔄 重试自动匹配'
    );
    retryBtn.id = 'gr-us-retry';
    const skipBtn = el(
      'button',
      'flex:1;padding:6px;border:1px solid #2a475e;border-radius:3px;background:#2a475e;color:#c7d5e0;cursor:pointer;',
      '⏭ 跳过'
    );
    skipBtn.id = 'gr-us-skip';
    btnRow.appendChild(retryBtn);
    btnRow.appendChild(skipBtn);
    body.appendChild(btnRow);
    const searchInput = el(
      'input',
      'width:100%;box-sizing:border-box;padding:8px;background:#0e141b;border:1px solid #2a475e;border-radius:3px;color:#c7d5e0;margin-bottom:8px;'
    );
    searchInput.id = 'gr-us-cand-input';
    searchInput.type = 'text';
    searchInput.placeholder = '输入游戏名搜索...';
    body.appendChild(searchInput);
    const bindRow = el('div', 'display:flex;gap:8px;margin-bottom:10px;');
    const bindInput = el(
      'input',
      'flex:1;min-width:0;padding:6px 10px;background:#0e141b;border:1px solid #2a475e;border-radius:3px;color:#c7d5e0;'
    );
    bindInput.id = 'gr-us-bind-input';
    bindInput.type = 'text';
    bindInput.placeholder = '或直接绑定 AppID（纯数字 / 商店链接）';
    const bindBtn = el(
      'button',
      'flex:none;padding:6px 12px;border:1px solid #2a475e;border-radius:3px;background:#2a475e;color:#c7d5e0;cursor:pointer;',
      '🔗 绑定'
    );
    bindBtn.id = 'gr-us-bind-btn';
    bindRow.appendChild(bindInput);
    bindRow.appendChild(bindBtn);
    body.appendChild(bindRow);
    const listEl = el('div', 'max-height:300px;overflow-y:auto;');
    listEl.id = 'gr-us-cand-list';
    body.appendChild(listEl);

    const listStatus = (text, color) => {
      const wrap = el('div', 'padding:20px;text-align:center;color:' + (color || '#8f98a0') + ';', text);
      listEl.replaceChildren(wrap);
    };
    let kbIndex = -1;

    async function searchAndRender(keyword) {
      listStatus('⏳ 搜索中...');
      const term = String(keyword || gameName);
      let candidates = [];
      try {
        const data = await storeSearch(term, 'schinese');
        candidates = (data.items || []).filter((i) => !addonNameRe.test(i.name || '')).slice(0, 8);
      } catch {
        listStatus('搜索失败，请检查网络', '#e74c3c');
        return;
      }
      if (candidates.length === 0) {
        listStatus('未找到候选游戏，请尝试其他关键词');
        return;
      }
      const listFrag = document.createDocumentFragment();
      for (const c of candidates) {
        const itemEl = el('div');
        itemEl.className = 'gr-cand';
        itemEl.setAttribute('role', 'option');
        itemEl.setAttribute('data-appid', String(c.id));
        const outer = el('div', 'flex:1;min-width:0;');
        outer.appendChild(
          el(
            'div',
            'font-size:12px;color:#c7d5e0;font-weight:bold;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
            c.name || ''
          )
        );
        outer.appendChild(el('div', 'font-size:10px;color:#8f98a0;', 'App ID: ' + c.id));
        itemEl.appendChild(outer);
        listFrag.appendChild(itemEl);
      }
      listEl.replaceChildren(listFrag);
      const items = [...listEl.querySelectorAll('.gr-cand')];
      const setActive = (i) => {
        kbIndex = (i + items.length) % items.length;
        items.forEach((it, idx) => it.classList.toggle('active', idx === kbIndex));
      };
      const kbHandler = (ev) => {
        if (!document.body.contains(listEl)) {
          document.removeEventListener('keydown', kbHandler);
          return;
        }
        if (ev.key === 'ArrowDown') {
          ev.preventDefault();
          setActive(kbIndex + 1);
        } else if (ev.key === 'ArrowUp') {
          ev.preventDefault();
          setActive(kbIndex - 1);
        } else if (ev.key === 'Enter' && kbIndex >= 0) {
          ev.preventDefault();
          items[kbIndex].click();
        } else if (ev.key === 'Escape') {
          document.removeEventListener('keydown', kbHandler);
        }
      };
      document.addEventListener('keydown', kbHandler);
      items.forEach((item) => {
        item.addEventListener('click', async () => {
          const appId = item.getAttribute('data-appid');
          listStatus('⏳ 正在获取详情...');
          const data = await rateGame(appId, {});
          if (data) {
            saveCorrection(gameName, appId, null); // 手动确认 → 纠正映射（优先于一切索引）
            deleteNameIndexEntry(gameName);
            recordNameIndex(gameName, appId);
            renderFloat(data);
          } else {
            listStatus('获取详情失败，请重试', '#e74c3c');
          }
        });
      });
    }

    body.querySelector('#gr-us-retry').addEventListener('click', async () => {
      const btn = body.querySelector('#gr-us-retry');
      btn.disabled = true;
      btn.textContent = '⏳ 重试中...';
      const resolved = await lookupAndRate(gameName, {
        rawTitle: document.title,
        ignoreNegativeCache: true,
        appId: extractAppIdFromImages() || undefined
      });
      const data = resolved && resolved.networkFailed ? null : resolved; // 三态哨兵按未命中处理
      if (data) {
        renderFloat(data);
      } else {
        btn.disabled = false;
        btn.textContent = '❌ 仍未命中';
      }
    });
    body.querySelector('#gr-us-skip').addEventListener('click', () => {
      cancelAutoRetry();
      const f = document.getElementById('gr-us-float');
      if (f) f.remove();
    });
    let searchTimer = null;
    const input = body.querySelector('#gr-us-cand-input');
    input.addEventListener('input', () => {
      if (searchTimer) clearTimeout(searchTimer);
      const keyword = String(input.value || '').trim();
      if (keyword.length < 2) return;
      searchTimer = setTimeout(() => searchAndRender(keyword), 300);
    });

    // v14.15.0 N3：手动绑定 AppID（storesearch 搜不到已下架游戏的用户兜底；
    // 与扩展同语义：纠正映射优先于一切索引，绑定前 appdetails 确认存在）。
    // v14.29.0：面板 DOM 化后直接引用构建引用（原 body.querySelector 重取退场）
    if (bindBtn && bindInput) {
      bindBtn.addEventListener('click', async () => {
        const text = String(bindInput.value || '').trim();
        let appId = null;
        const urlMatch = text.match(/store\.steampowered\.com\/app\/(\d{1,10})(?!\d)/i);
        if (urlMatch) appId = urlMatch[1];
        else if (/^\d{1,10}$/.test(text)) appId = text;
        if (!appId) {
          bindInput.value = '';
          bindInput.placeholder = '❌ 格式：1-10 位数字或 store.steampowered.com/app/数字 链接';
          return;
        }
        bindBtn.disabled = true;
        listStatus('⏳ 正在确认 AppID ' + appId + ' ...');
        const details = await fetchAppDetails(appId);
        if (!details) {
          listStatus('未找到该 AppID 的 Steam 条目，请核对', '#e74c3c');
          bindBtn.disabled = false;
          return;
        }
        saveCorrection(gameName, appId, null);
        deleteNameIndexEntry(gameName);
        recordNameIndex(gameName, appId);
        const data = await rateGame(appId, { name: details.name || '' });
        if (data) renderFloat(data);
      });
    }
    searchAndRender(gameName);
  }

  /** 详情页主流程（createSteamFloat 语义：查改评 → 浮窗/候选/自动重查） */
  async function runDetailPage() {
    const gameName = detectDetailGameName();
    if (!gameName || gameName.length < 2) return;
    injectCss();
    showFloatLoading();
    const pageUrl = location.origin + location.pathname;
    // URL 索引命中快路径（同 URL=同游戏，免搜索）
    const urlHit = urlIndexGet(pageUrl);
    if (urlHit && urlHit.appId) {
      const cached = await rateGame(urlHit.appId, { name: urlHit.name });
      if (cached) {
        renderFloat(cached);
        return;
      }
    }
    const imgAppId = extractAppIdFromImages();
    let data = null;
    try {
      const resolved = await lookupAndRate(gameName, {
        rawTitle: document.title,
        appId: imgAppId || undefined,
        pageUrl
      });
      data = resolved && resolved.networkFailed ? null : resolved; // 三态哨兵转常规未命中（下方网络重查承接）
    } catch {
      data = null;
    }
    if (data) {
      renderFloat(data);
      return;
    }
    // 未命中：区分网络故障（自动重查一次）与确认未找到（候选面板）
    const netDown = isCircuitOpen('store') || isCircuitOpen('community');
    if (netDown && !autoRetriedGames.has(gameName)) {
      autoRetriedGames.add(gameName);
      cancelAutoRetry();
      autoRetryTimer = setTimeout(async () => {
        autoRetryTimer = null;
        try {
          const retry = await lookupAndRate(gameName, { rawTitle: document.title, ignoreNegativeCache: true });
          if (retry && !retry.networkFailed) {
            renderFloat(retry);
            return;
          }
        } catch {
          /* 保持现状 */
        }
        renderCandidates(gameName, 'steam-api-unreachable（网络故障期未命中）');
      }, AUTO_RETRY_DELAY_MS);
      showFloatLoading('网络故障期未命中，30s 后自动重查一次…');
      return;
    }
    renderCandidates(gameName, netDown ? 'steam-api-unreachable' : 'not-found');
  }
  // ==================================================================
  // §7 设置（对齐扩展 DEFAULT_SETTINGS 用户可调子集；GM 存储）
  // ==================================================================
  const SETTINGS_KEY = 'settings';
  const DEFAULT_US_SETTINGS = {
    redTitleRating: RED_TITLE_DEFAULT, // 标题变红阈值（总+近30天 均 > 阈值）
    enableRatingFilter: false, // 好评率过滤
    minSteamRatingFilter: 0, // 过滤阈值 0-100
    badgeAll: true, // 总好评率徽章
    badgeRecent: true, // 近 30 天徽章
    floatSide: 'left', // 浮窗位置 left|right
    detailFloatExpanded: true
  };
  const settings = (() => {
    const saved = gmStore.get(SETTINGS_KEY, null);
    return saved && typeof saved === 'object'
      ? Object.assign({}, DEFAULT_US_SETTINGS, saved)
      : Object.assign({}, DEFAULT_US_SETTINGS);
  })();
  const currentSettings = settings; // retryItem 等渲染引用（扩展 settings 参数口径）

  function saveSettings() {
    gmStore.set(SETTINGS_KEY, settings);
  }

  // ==================================================================
  // §8 站点规则（adapters/sites/*.js 三核心站移植 + 通用兜底）
  // ==================================================================
  const SITE_RULES = [
    {
      key: 'xdgame',
      domains: ['xdgame.com'],
      detailUrlPatterns: ['/game/\\d+\\.html?$', '/\\d+\\.html?$'],
      listPagePatterns: ['/pcdj', '^(/|$)', '/list/'],
      listItem: {
        containers: ['li.game-item', '.game-item', 'li'],
        titleLink: 'a.tit',
        titleEls: ['h2', 'h3', '.title'],
        minLen: 2,
        maxLen: 200,
        fallbackLinks: true
      }
    },
    {
      key: 'xianyudanji',
      domains: ['xianyudanji.gg'],
      detailUrlPatterns: ['/\\d+\\.html?$', '/[^/]*\\d[^/]*/?$'],
      listPagePatterns: ['^(/|$)', '/page/\\d+', '/category/', '/tag/', '\\bs='],
      listItem: {
        containers: ['.post', '.article', '.entry', '.item', 'article'],
        titleLink: '',
        titleEls: ['h2', 'h3', '.title', '.entry-title'],
        minLen: 2,
        maxLen: 100,
        fallbackLinks: true
      }
    },
    {
      key: 'gamer520',
      domains: ['gamer520.com', 'gamers520.com'],
      detailUrlPatterns: ['/\\d+\\.html?$', '/[^/]*\\d[^/]*/?$'],
      listPagePatterns: ['^(/|$)', '/page/\\d+', '/category/', '/tag/', '\\bs='],
      listItem: {
        containers: ['.post', '.article', '.entry', '.item', 'article'],
        titleLink: '',
        titleEls: ['h2', 'h3', '.title', '.entry-title'],
        minLen: 2,
        maxLen: 100,
        fallbackLinks: true
      }
    }
  ];
  const GENERIC_RULE = {
    key: 'generic',
    domains: [],
    detailUrlPatterns: ['/\\d+\\.html?$', '/game/\\d+', '/\\d+\\.html'],
    listPagePatterns: [],
    listItem: {
      containers: ['.post', '.article', '.item', 'article', 'li'],
      titleLink: '',
      titleEls: ['h2', 'h3', '.title', '.entry-title'],
      minLen: 2,
      maxLen: 200,
      fallbackLinks: true
    }
  };

  function currentRule() {
    const host = location.hostname.replace(/^www\./, '');
    for (const rule of SITE_RULES) {
      if (rule.domains.some((d) => host === d || host.endsWith('.' + d))) return rule;
    }
    return GENERIC_RULE;
  }

  function matchesAny(patterns, path) {
    return patterns.some((p) => {
      try {
        return new RegExp(p, 'i').test(path);
      } catch {
        return false;
      }
    });
  }

  // ==================================================================
  // §9 列表页扫描 + 顺序批处理（list-page/list-batch 语义简化：
  // 单队列串行 + 就绪即上徽章 + 等待徽章显示队列位置）
  // ==================================================================
  // v14.16.0 O10：增量扫描标记——观察器每轮 rescan 此前全页重扫所有链接
  //（fallbackLinks 全页 a[href] ×20 轮上限）；WeakSet 已处理标记让重扫只碰
  // 新增节点（GC 友好，节点移除自动出表）。
  const processedLinks = new WeakSet();
  function extractListItems(rule) {
    const path = location.pathname + location.search;
    const isList = rule.listPagePatterns.length === 0 ? true : matchesAny(rule.listPagePatterns, path);
    if (!isList) return [];
    const li = rule.listItem;
    const seen = new Set();
    const items = [];
    const pushItem = (link, titleEl) => {
      if (!link || items.length >= MAX_SCAN_LINKS) return;
      if (processedLinks.has(link)) return; // O10：已入队链接零成本跳过
      const href = link.href || link.getAttribute('href') || '';
      if (!href || seen.has(href)) return;
      const rawName = String(titleEl ? titleEl.textContent : link.textContent || '').trim();
      if (rawName.length < li.minLen || rawName.length > li.maxLen) return;
      if (link.querySelector('.gr-rating-badge') || link.querySelector('.gr-working-badge')) return; // 防重复
      seen.add(href);
      processedLinks.add(link);
      items.push({ link, element: link.closest(li.containers.join(',')) || link, titleEl, gameName: rawName, href });
    };
    for (const containerSel of li.containers) {
      let containers = [];
      try {
        containers = [...document.querySelectorAll(containerSel)];
      } catch {
        containers = [];
      }
      for (const container of containers) {
        const linkSel = li.titleLink || 'a[href]';
        const link = container.querySelector(linkSel) || container.querySelector('a[href]');
        if (!link) continue;
        let titleEl = null;
        for (const tSel of li.titleEls) {
          titleEl = container.querySelector(tSel);
          if (titleEl) break;
        }
        if (matchesAny(rule.detailUrlPatterns, new URL(link.href, location.href).pathname)) pushItem(link, titleEl);
      }
      if (items.length > 0) break; // 首个命中的容器策略即用
    }
    // 全页兜底（fallbackLinks：容器策略无结果时）
    if (items.length === 0 && li.fallbackLinks) {
      for (const a of document.querySelectorAll('a[href]')) {
        const path = new URL(a.href, location.href).pathname;
        if (matchesAny(rule.detailUrlPatterns, path)) {
          let titleEl = null;
          for (const tSel of li.titleEls) {
            titleEl = a.querySelector(tSel) || a.parentElement.querySelector(tSel);
            if (titleEl) break;
          }
          pushItem(a, titleEl);
        }
      }
    }
    return items;
  }

  /** 单项处理：resolve → 冲突防线 → rate → 徽章（就绪快路径同步应用） */
  async function processItem(item, index, total) {
    renderWaitingBadge(item, '⏳ 检索中 ' + index + '/' + total);
    try {
      const pageUrl = new URL(item.href, location.href).origin + new URL(item.href, location.href).pathname;
      // URL 索引命中快路径（同 URL=同游戏）
      const urlHit = urlIndexGet(pageUrl);
      let data = null;
      if (urlHit && urlHit.appId) {
        data = await rateGame(urlHit.appId, { name: urlHit.name });
        if (data) {
          // v14.29.0：快路径同样过同站冲突防线（扩展 wave-1 缓存命中同语义）
          const conflict = claimOrDetectMatch(item.gameName, pageUrl, urlHit.appId);
          attachMatchConfidence(data, item.gameName, data.name || urlHit.name || '', 'url');
          if (conflict) forceConflictMarkers(data);
        }
      }
      let networkFailed = false;
      if (!data) {
        const resolved = await lookupAndRate(item.gameName, { rawTitle: item.gameName, pageUrl });
        if (resolved && resolved.networkFailed) {
          networkFailed = true;
        } else {
          data = resolved;
        }
      }
      removeWaitingBadge(item);
      if (networkFailed) {
        renderNetworkErrorBadge(item); // v14.29.0：故障三态（网络异常 ≠ 未找到）
        return;
      }
      renderRatingBadge(item, data, currentSettings);
      applyFilter(item, data);
      if (data && data.appId && !data.matchConflict) {
        recordNameIndex(item.gameName, data.appId); // 冲突条目跳写（错误一侧不固化）
      }
    } catch (e) {
      removeWaitingBadge(item);
      // v14.29.0：故障三态——传输层失败（熔断/超时/网络错误）渲染「网络异常」，
      // 其余保持「未找到」（此前一律未找到 = 与"Steam 无此游戏"同形）
      const msg = String((e && e.message) || e || '');
      if (/network-error|timeout|circuit-open/.test(msg)) {
        renderNetworkErrorBadge(item);
      } else {
        renderRatingBadge(item, null, currentSettings); // 未找到徽章（可点击重查）
      }
    }
  }

  /** 好评率过滤（enableRatingFilter：仅对已有评分项隐藏，未知保留） */
  function applyFilter(item, data) {
    if (!settings.enableRatingFilter) return;
    const min = Number(settings.minSteamRatingFilter) || 0;
    if (!min) return;
    const rate = data && data.positiveRate;
    if (rate != null && rate < min) {
      item.element.style.display = 'none';
    }
  }

  /** 列表页主流程：扫描 → 顺序队列 → 观察器补扫（有界） */
  async function runListPage() {
    injectCss();
    const rule = currentRule();
    const items = extractListItems(rule);
    if (items.length === 0) return;
    let done = 0;
    for (const item of items) {
      done += 1;
      await processItem(item, done, items.length); // 串行（限速槽在 gmFetch 内）
    }
    // SPA/懒加载补扫：MutationObserver 去抖 800ms，最多 20 轮
    let rescans = 0;
    const mo = new MutationObserver(() => {
      if (rescans >= 20) {
        mo.disconnect();
        return;
      }
      clearTimeout(mo._t);
      mo._t = setTimeout(async () => {
        rescans += 1;
        const fresh = extractListItems(rule).filter((it) => !it.link.querySelector('.gr-rating-badge'));
        let idx = 0;
        for (const item of fresh) {
          idx += 1;
          await processItem(item, idx, fresh.length);
        }
      }, 800);
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  // ==================================================================
  // §10 菜单 + 引导
  // ==================================================================
  function registerMenus() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    GM_registerMenuCommand(
      '🔁 切换好评率过滤（当前 ' + (settings.enableRatingFilter ? '开 ≥' + settings.minSteamRatingFilter : '关') + '）',
      () => {
        if (settings.enableRatingFilter) {
          settings.enableRatingFilter = false;
        } else {
          const v = Number(
            prompt('好评率过滤阈值（0-100，低于该值的游戏将被隐藏）：', String(settings.minSteamRatingFilter || 40))
          );
          if (!Number.isFinite(v)) return;
          settings.minSteamRatingFilter = Math.min(100, Math.max(0, Math.round(v)));
          settings.enableRatingFilter = true;
        }
        saveSettings();
        location.reload();
      }
    );
    GM_registerMenuCommand('🔴 标题变红阈值（当前 ' + (settings.redTitleRating || '关') + '）', () => {
      const v = Number(prompt('总好评率与近 30 天均大于该值时标题变红（0=关闭）：', String(settings.redTitleRating)));
      if (!Number.isFinite(v)) return;
      settings.redTitleRating = Math.min(100, Math.max(0, Math.round(v)));
      saveSettings();
      location.reload();
    });
    GM_registerMenuCommand('🧹 清空全部缓存（保留设置与纠正映射）', () => {
      if (!confirm('清空评分缓存/名称索引/URL 索引？（人工纠正映射保留）')) return;
      for (const k of gmStore.keys()) {
        if (/^(rating:|name:|url:)/.test(k)) gmStore.del(k);
      }
      alert('已清空。刷新页面生效。');
    });
    GM_registerMenuCommand('📋 导出人工纠正映射（控制台）', () => {
      const out = {};
      for (const k of gmStore.keys()) {
        if (k.indexOf('manual:') === 0) out[k.slice('manual:'.length)] = (gmStore.get(k, null) || {}).d;
      }
      console.log('[游戏雷达] 人工纠正映射（JSON）：', JSON.stringify(out, null, 2));
      alert('映射已打印到控制台（F12 → Console），共 ' + Object.keys(out).length + ' 条。');
    });
  }

  /** 引导（tracker 语义简化：详情页/列表页二分 + URL 索引快速路径） */
  function boot() {
    if (!global.location || !document.body) return;
    const rule = currentRule();
    const path = location.pathname;
    if (matchesAny(rule.detailUrlPatterns, path)) {
      runDetailPage();
    } else {
      runListPage();
    }
  }

  registerMenus();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // 调试面（控制台：window.__GR_US__ 暴露纯函数/词表快照与存储，便于诊断）
  global.__GR_US__ = {
    version: SCRIPT_VERSION,
    pure: {
      parseGameTitle,
      nameMatchesSearch,
      matchCandidateScore,
      coreTokensOf,
      seqNumsOf,
      cjkBigramDice,
      isCrossoverEntry,
      isEnEdition,
      isNewReleaseDate,
      // v14.29.0 同步：置信度/冲突防线诊断面
      titleSimilarity,
      extractTitleYear,
      rateMatchConfidenceLite,
      gameKeyOf,
      urlIndexFindHostConflict,
      claimOrDetectMatch
    },
    vocab: VOCAB,
    store: gmStore,
    settings: () => settings
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
