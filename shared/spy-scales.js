// @ts-strict
/**
 * 游戏雷达 Game Radar - SteamSpy 信号归一化刻度单源 / SteamSpy Scale Single Source
 *
 * v14.2.0（补充轮 P1-2）：刻度常量此前住在 background/core/constants.js，
 * content 层不能反向 import——heatLabelFor 把 salesLogDivisor 复制成字面量
 * `/7`，推荐分与浮窗热度标签语义分裂。真源下沉 shared（跨侧纯数据层），
 * constants.js re-export 保持 engine 既有 import 路径不变。
 * Pure data single source; constants.js re-exports for the engine, content
 * imports directly (no more `/7` literal).
 */
export const SPY_SCALES = {
  playTimeDivisor: 600, // 平均时长分钟 ÷600 饱和
  heatLogDivisor: 5, // CCU 对数 ÷5（10 万人封顶）
  salesLogDivisor: 7, // owners 中点对数 ÷7（千万人封顶）
  reviewLogDivisor: 5, // 评论数对数 ÷5（10 万封顶）
  neutral: 0.3, // 无数据时的中性缺省分
  steamNeutral: 0.4 // Steam 无评分时的中性分
};
