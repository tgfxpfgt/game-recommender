/**
 * 游戏雷达 Game Radar - 设置面板事件绑定 / Settings Panel Bindings
 *
 * v14.3.0（第五轮 B3）：由 settings.js 拆分——LLM 连接测试、主题/LLM/权重
 * 事件绑定、数值滑块双向绑定。渲染器在 settings-render.js，浮窗模块顺序
 * UI 在 settings.js；经 window.__OPTS__ 命名空间协作。
 * Connection test + theme/LLM/weight bindings + range↔number sync, split
 * from settings.js; collaborating through the __OPTS__ namespace.
 */
(function (global) {
  'use strict';

  const OPTS = (global.__OPTS__ = global.__OPTS__ || {});

  // ============ 本地 LLM 端点权限（v14.26.0 P2-15） ============
  // manifest 不再静态持有 localhost/127.0.0.1 的 host 权限（最小权限）——
  // 仅当用户显式启用本地 LLM 端点时按需申请。permissions.request 必须在
  // 用户手势内调用：自动保存是 800ms 防抖（已脱离手势），故挂在 change/click
  // 事件上；已授权时 request 直接 resolve(true) 不弹窗。
  // localhost is now an optional host permission, requested on demand inside
  // user-gesture handlers (the debounced autosave can no longer carry one).
  const LOCAL_LLM_ORIGINS = { localhost: 'http://localhost/*', '127.0.0.1': 'http://127.0.0.1/*' };

  /** 端点指向本机时返回待申请的 origin，否则 null / origin to request, or null */
  function localOriginOf(endpoint) {
    try {
      const host = new URL(String(endpoint || '')).hostname;
      return LOCAL_LLM_ORIGINS[host] || null;
    } catch {
      return null;
    }
  }

  /**
   * 按需申请本地端点权限；返回是否可用（非本地端点恒 true）。
   * Request localhost permission on demand; always true for non-local endpoints.
   * @param {string} endpoint
   * @returns {Promise<boolean>}
   */
  async function ensureLocalEndpointPermission(endpoint) {
    const origin = localOriginOf(endpoint);
    if (!origin) return true;
    const perms = globalThis.chrome && globalThis.chrome.permissions;
    if (!perms || !perms.request) return true; // 非扩展页/旧浏览器：交由请求自身报错
    try {
      return await perms.request({ origins: [origin] });
    } catch {
      return false;
    }
  }

  // ============ Test LLM Connection / 测试 LLM 连接 ============
  // v14.5.0 B8：端点探测单点——fetch → {ok, status, data} 形状 + 错误归一
  // （原 local/openai 两分支各自手写 response.ok 判定与 JSON 容错）。
  // Unified endpoint probe (B8): one fetch → {ok, status, data} shape for both
  // provider branches; error text assembly stays at the call site.
  /** @param {string} url @param {RequestInit} [init] */
  async function probeEndpoint(url, init) {
    const response = await fetch(url, init);
    const data = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, data };
  }

  async function testLLMConnection() {
    const resultEl = document.getElementById('llmTestResult');
    resultEl.textContent = '测试中...';
    resultEl.className = 'test-result';

    const provider = document.getElementById('llmProvider').value;
    const endpoint = document.getElementById('llmEndpoint').value;
    const apiKey = document.getElementById('llmApiKey').value;
    const model = document.getElementById('llmModel').value;

    // v14.26.0 P2-15：本地端点权限按需申请（点击"测试连接"即用户手势）
    if (!(await ensureLocalEndpointPermission(endpoint))) {
      resultEl.textContent = '❌ 未授予本地端点访问权限（请重新允许后重试）';
      resultEl.className = 'test-result error';
      return;
    }

    try {
      let result;
      if (provider === 'local') {
        // Ollama - 测试模型列表
        const testUrl = endpoint.replace('/api/generate', '/api/tags');
        result = await probeEndpoint(testUrl, { method: 'GET' });
        if (!result.ok) throw new Error(`HTTP ${result.status}`);
        const models = Array.isArray(result.data && result.data.models) ? result.data.models : []; // v10.9：异型守卫
        const hasModel = models.some((m) => String((m && m.name) || '').includes(model));
        if (hasModel) {
          resultEl.textContent = `✅ 连接成功，模型 ${model} 可用`;
        } else {
          resultEl.textContent = `⚠️ 连接成功，但未找到模型 ${model}。可用: ${models.map((m) => m.name).join(', ')}`;
        }
      } else {
        // OpenAI 兼容接口
        result = await probeEndpoint(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: model,
            messages: [{ role: 'user', content: 'hi' }],
            max_tokens: 5
          })
        });
        if (!result.ok) {
          throw new Error((result.data && result.data.error && result.data.error.message) || `HTTP ${result.status}`);
        }
        resultEl.textContent = '✅ 连接成功';
      }
      resultEl.className = 'test-result success';
    } catch (e) {
      resultEl.textContent = `❌ 连接失败: ${String(e)}`;
      resultEl.className = 'test-result error';
    }
  }

  // ============ Theme / LLM / Weight Bindings（v14 B2 自 options.js 迁入） ============
  // 事件绑定与渲染同域集中；收集与保存仍在 options.js saveSettings。

  // v6.4.19：界面皮肤切换（立即生效）+ v7.0.5：自定义主题 CSS 导入/清除（本地文件，无网络）
  function bindThemeEvents() {
    document.getElementById('uiTheme').addEventListener('change', (e) => {
      OPTS.scheduleAutoSave();
      if (globalThis.__GR_SETTINGS_UTILS__ && globalThis.__GR_SETTINGS_UTILS__.applyTheme) {
        globalThis.__GR_SETTINGS_UTILS__.applyTheme(e.target.value);
      }
    });

    document.getElementById('themeCssImport').addEventListener('click', () => {
      document.getElementById('themeCssFile').click();
    });
    document.getElementById('themeCssFile').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const css = String(reader.result || '');
        OPTS.currentSettings.customThemeCss = css;
        const status = document.getElementById('themeCssStatus');
        status.textContent = `✅ 已导入（${(css.length / 1024).toFixed(1)} KB）`;
        if (globalThis.__GR_SETTINGS_UTILS__ && globalThis.__GR_SETTINGS_UTILS__.applyCustomTheme) {
          globalThis.__GR_SETTINGS_UTILS__.applyCustomTheme(css);
        }
        OPTS.scheduleAutoSave();
      };
      reader.readAsText(file);
      e.target.value = '';
    });
    document.getElementById('themeCssClear').addEventListener('click', () => {
      OPTS.currentSettings.customThemeCss = '';
      document.getElementById('themeCssStatus').textContent = '✅ 已清除';
      if (globalThis.__GR_SETTINGS_UTILS__ && globalThis.__GR_SETTINGS_UTILS__.applyCustomTheme) {
        globalThis.__GR_SETTINGS_UTILS__.applyCustomTheme('');
      }
      OPTS.scheduleAutoSave();
    });
  }

  // LLM 开关/提供商切换/文本输入（防抖自动保存）/Temperature/测试连接
  function bindLLMEvents() {
    document.getElementById('useLLM').addEventListener('change', () => {
      OPTS.toggleLLMSettings();
      OPTS.scheduleAutoSave();
    });

    document.getElementById('llmProvider').addEventListener('change', (e) => {
      OPTS.toggleApiKeyRow();
      const presets = {
        local: 'http://localhost:11434/api/generate',
        openai: 'https://api.openai.com/v1/chat/completions',
        custom: ''
      };
      if (presets[e.target.value]) {
        document.getElementById('llmEndpoint').value = presets[e.target.value];
        // v14.26.0 P2-15：切到本地提供商即申请 localhost 权限（change = 用户手势）
        void ensureLocalEndpointPermission(presets[e.target.value]);
      }
      OPTS.scheduleAutoSave();
    });

    // v14.26.0 P2-15：手填/粘贴本地端点后（change = 失焦/回车，属用户手势）按需申请
    document.getElementById('llmEndpoint').addEventListener('change', (e) => {
      void ensureLocalEndpointPermission(e.target.value);
    });

    // LLM 文本输入（防抖自动保存）
    ['llmEndpoint', 'llmApiKey', 'llmModel'].forEach((id) => {
      document.getElementById(id).addEventListener('input', () => OPTS.scheduleAutoSave());
    });

    // Temperature
    document.getElementById('llmTemp').addEventListener('input', (e) => {
      document.getElementById('llmTempVal').textContent = (e.target.value / 100).toFixed(1);
      OPTS.scheduleAutoSave();
    });

    // 测试 LLM 连接
    document.getElementById('testLLM').addEventListener('click', OPTS.testLLMConnection);
  }

  // 权重滑块（v4.0.0：新增 playTime/heat；v10.1.0：新增 appStat 两项）
  function bindWeightEvents() {
    const weightIds = [
      'weightClick',
      'weightDownload',
      'weightKeyword',
      'weightSteam',
      'weightPlayTime',
      'weightHeat',
      'weightSales',
      'weightReviews',
      'weightAppStatDownload',
      'weightAppStatDetailView'
    ];
    weightIds.forEach((id) => {
      document.getElementById(id).addEventListener('input', (e) => {
        document.getElementById(`${id}Val`).textContent = (e.target.value / 100).toFixed(2);
        OPTS.updateWeightSum();
        OPTS.scheduleAutoSave();
      });
    });
  }

  // ============ 数值滑块 + 手动输入双向绑定（v9.6.0） ============
  // Slider ↔ number-input two-way sync for all range controls.
  function bindRangeNumberInputs() {
    document.querySelectorAll('input[type="range"]').forEach((range) => {
      const input = document.getElementById(range.id + 'Input');
      if (!input) return;
      // 滑块 → 输入框
      range.addEventListener('input', () => {
        input.value = range.value;
      });
      // 输入框 → 滑块（clamp 到 min/max；回车或失焦生效）
      const apply = () => {
        let v = Number(input.value);
        if (Number.isNaN(v)) return;
        v = Math.min(range.max, Math.max(range.min, v));
        input.value = v;
        if (String(range.value) !== String(v)) {
          range.value = v;
          range.dispatchEvent(new Event('input', { bubbles: true }));
        }
      };
      input.addEventListener('change', apply);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') apply();
      });
    });
  }

  OPTS.testLLMConnection = testLLMConnection;
  OPTS.bindThemeEvents = bindThemeEvents;
  OPTS.bindLLMEvents = bindLLMEvents;
  OPTS.bindWeightEvents = bindWeightEvents;
  OPTS.bindRangeNumberInputs = bindRangeNumberInputs;
})(typeof globalThis !== 'undefined' ? globalThis : this);
