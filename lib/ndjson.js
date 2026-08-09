/**
 * Game Recommender - ND-JSON (JSON Lines) 编解码 / ND-JSON Codec
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
    return (entries || []).map(e => JSON.stringify(e)).join('\n');
  },
  // 多行文本 → 数组（忽略空行与损坏行）/ Text → Array (skips empty/broken lines)
  decode(text) {
    return String(text || '')
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .map(l => {
        try { return JSON.parse(l); } catch (e) { return null; }
      })
      .filter(e => e !== null);
  }
};
