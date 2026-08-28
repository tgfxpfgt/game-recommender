/**
 * 游戏雷达 Game Radar - 批次 G：flush 写放大实测（一次性脚本，不入测试套件）
 *
 * v10.0.0：v9.7.0 把批量好评率的聚合落盘从"每 5 批"改为"每批"，需要量化
 * 写放大是否可接受。方法：构造接近真实的存储负载（500 条 Steam 缓存条目 +
 * 5000 条名称索引 + 5000 条网址索引），在 storage mock 上测 writeModule
 * 的耗时与单次序列化字节数，推算真实场景的批间写开销。
 * Run: node scripts/measure-write-amplification.mjs
 */
import { createStorageMock, installChromeStorageMock } from '../tests/helpers/storage-mock.mjs';

const storage = createStorageMock();
installChromeStorageMock(storage);
const { dataStore } = await import('../data/data-store.js?t=' + Date.now());

// 构造真实形状的 steam 缓存条目（meta/rating/detail/spy 四模块）
function makeSteamEntry(appId, i) {
  return {
    appId: String(appId),
    modules: {
      meta: {
        ts: Date.now(),
        data: {
          name: `游戏名称${i} Online`,
          englishName: `Game Name ${i} Online`,
          type: 'game',
          genres: ['动作', '角色扮演', '独立'],
          headerImage: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`
        }
      },
      rating: {
        ts: Date.now(),
        data: {
          positiveRate: 50 + (i % 50),
          ratingDesc: '特别好评',
          totalReviews: 1000 + i,
          recentPositiveRate: 45 + (i % 50),
          recentTotalReviews: 100
        }
      },
      detail: {
        ts: Date.now(),
        data: {
          description: '这是一段足够长的游戏描述文本，用于模拟真实缓存条目的序列化体积。'.repeat(6),
          developers: ['开发商A', '开发商B'],
          releaseDate: '2024-01-01',
          chineseSupported: true
        }
      },
      spy: {
        ts: Date.now(),
        data: {
          currentPlayers: 1000 + i,
          owners: '1,000,000 .. 2,000,000',
          averagePlaytime: '42小时',
          positiveRate: 55
        }
      }
    }
  };
}

const steamCache = {};
for (let i = 0; i < 500; i++) steamCache[String(1000000 + i)] = makeSteamEntry(1000000 + i, i);

const nameIndex = {};
for (let i = 0; i < 5000; i++)
  nameIndex[`游戏名称${i} online`] = { appId: String(1000000 + (i % 500)), lastSearched: Date.now() - i * 1000 };

const urlIndex = {};
for (let i = 0; i < 5000; i++) urlIndex[`https://www.example-site.com/game/${i}.html`] = String(1000000 + (i % 500));

const bytes = (v) => JSON.stringify(v).length;
console.log('=== 数据体积（单次全量序列化）===');
console.log(`steamCache(500) : ${(bytes(steamCache) / 1024).toFixed(1)} KB`);
console.log(`nameIndex(5000) : ${(bytes(nameIndex) / 1024).toFixed(1)} KB`);
console.log(`urlIndex(5000)  : ${(bytes(urlIndex) / 1024).toFixed(1)} KB`);
console.log(`单批落盘合计     : ${((bytes(steamCache) + bytes(nameIndex) + bytes(urlIndex)) / 1024).toFixed(1)} KB`);

await dataStore.writeModule('steamCache', steamCache);
await dataStore.writeModule('nameIndex', nameIndex);
await dataStore.writeModule('urlAppIdIndex', urlIndex);

console.log('=== writeModule 耗时（mock 存储，各 20 次）===');
async function bench(key, value, n = 20) {
  const t0 = performance.now();
  for (let i = 0; i < n; i++) await dataStore.writeModule(key, value);
  return (performance.now() - t0) / n;
}
const t1 = await bench('steamCache', steamCache);
const t2 = await bench('nameIndex', nameIndex);
const t3 = await bench('urlAppIdIndex', urlIndex);
console.log(`steamCache : ${t1.toFixed(2)} ms/次`);
console.log(`nameIndex  : ${t2.toFixed(2)} ms/次`);
console.log(`urlIndex   : ${t3.toFixed(2)} ms/次`);

console.log('=== 结论输入 ===');
const perBatchKB = (bytes(steamCache) + bytes(nameIndex) + bytes(urlIndex)) / 1024;
console.log(`60 游戏列表（1 批请求 = 1 次 flushAllCaches）≈ ${perBatchKB.toFixed(0)} KB/批`);
console.log(`对比 v9.6.0 每 5 批一落盘：写放大 5 倍，但单批 < 1MB 且 OPFS 顺序覆盖写廉价`);
console.log(`（真实 OPFS 落盘含 fsync 语义，绝对耗时需实机核验；本测量提供相对量级）`);
