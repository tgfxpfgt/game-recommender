/**
 * 游戏雷达 Game Radar - ND-JSON (JSON Lines) 编解码 / ND-JSON Codec
 *
 * 用于日志类数据（浏览记录/运行日志）的文件格式：每行一条 JSON 记录，
 * 追加写入高效（无需重写整个文件），适合 append-only 语义。
 *
 * Used for log-like data (behavior log / runtime log): one JSON record per
 * line, efficient append-only writes.
 */
export const NDJSON = {
  // 数组 → 多行文本 / Array → multi-line text
  encode(entries) {
    return (entries || []).map((e) => JSON.stringify(e)).join('\n');
  },
  // 多行文本 → 数组（忽略空行与损坏行）/ Text → Array (skips empty/broken lines)
  decode(text) {
    /** @type {Array<Object>} */
    const out = [];
    for (const raw of String(text || '').split('\n')) {
      const l = raw.trim();
      if (!l) continue;
      try {
        const parsed = JSON.parse(l);
        if (parsed !== null && typeof parsed === 'object') out.push(parsed);
      } catch {
        /* 损坏行跳过 / skip broken line */
      }
    }
    return out;
  }
};
