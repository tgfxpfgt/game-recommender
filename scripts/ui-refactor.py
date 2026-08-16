# -*- coding: utf-8 -*-
"""UI 重构批量脚本：页面 class 组件化（gr-*）+ 清理重复组件定义（v8.1.0）
Run: python scripts/ui-refactor.py
"""
import io
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

FILES = [
    'options/options.html',
    'options/options.css',
    'popup/popup.html',
    'popup/popup.css',
    'dashboard/dashboard.html',
    'dashboard/dashboard.css',
    'freegames/freegames.html',
    'freegames/freegames.css',
    'hub/hub.html',
    'hub/hub.css',
    'welcome/welcome.html',
    'welcome/welcome.css',
]

# class 属性内 token 替换（HTML）：词边界
HTML_MAP = [
    ('btn', 'gr-btn'),
    ('text-input', 'gr-input'),
    ('switch', 'gr-switch'),
    ('slider', 'gr-slider-ui'),
    ('check-item', 'gr-check'),
    ('nav-item', 'gr-nav-item'),
    ('stat-card', 'gr-stat-card'),
    ('range', 'gr-range'),
]

# CSS 选择器 token 替换（按特异性顺序）
CSS_MAP = [
    (r'\.btn-sm', '.gr-btn.sm'),
    (r'\.btn-primary', '.gr-btn.primary'),
    (r'\.btn-danger', '.gr-btn.danger'),
    (r'\.btn-ghost', '.gr-btn.ghost'),
    (r'\.btn', '.gr-btn'),
    (r'\.text-input', '.gr-input'),
    (r'\.switch', '.gr-switch'),
    (r'\.slider', '.gr-slider-ui'),
    (r'\.check-item', '.gr-check'),
    (r'\.nav-item', '.gr-nav-item'),
    (r'\.stat-card', '.gr-stat-card'),
    (r'(?<!\.gr-)\.range(?=[\s,:{])', '.gr-range'),  # 排除 .gr-range 自身与 .range-group 等
]

# CSS 中与 ui-theme.css 重复、需整体删除的组件定义块起点
DUP_SELECTORS = ['.gr-btn', '.gr-switch', '.gr-range', '.gr-input', '.gr-tag', '.gr-card', '.gr-slider-ui']


def drop_dup_blocks(css):
    """删除以 DUP_SELECTORS 起始的选择器块（块起点 = 不以空格/注释开头、不以 ; } 结尾的行）"""
    lines = css.split('\n')
    out = []
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        is_selector_start = (
            stripped
            and not stripped.startswith('/*')
            and not stripped.startswith('}')
            and not stripped.startswith('@')
            and not stripped.endswith(';')
            and not stripped.endswith('{')
        )
        drop = False
        if is_selector_start:
            # 拼接直到 { 的多行选择器
            j = i
            sel = ''
            while j < len(lines) and '{' not in lines[j]:
                sel += ' ' + lines[j].strip()
                j += 1
            if j < len(lines):
                sel += ' ' + lines[j].strip()
            for s in DUP_SELECTORS:
                for part in sel.split(','):
                    p = part.strip()
                    if p == s or p.startswith(s + ' ') or p.startswith(s + ':'):
                        drop = True
                        break
                if drop:
                    break
            if drop:
                depth = 0
                while i < len(lines):
                    depth += lines[i].count('{') - lines[i].count('}')
                    i += 1
                    if depth <= 0:
                        break
                continue
        out.append(line)
        i += 1
    return '\n'.join(out)


for f in FILES:
    p = os.path.join(ROOT, f)
    s = io.open(p, encoding='utf-8').read()
    if f.endswith('.html'):
        for old, new in HTML_MAP:
            s = re.sub(r'\b' + re.escape(old) + r'\b', new, s)
    else:
        for pat, rep in CSS_MAP:
            s = re.sub(pat, rep, s)
        s = drop_dup_blocks(s)
    io.open(p, 'w', encoding='utf-8', newline='').write(s)
    print('refactored', f)

print('done')
