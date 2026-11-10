/**
 * 游戏雷达 Game Radar - 纯 JS 读取 zip 条目名 / Pure-JS zip entry-name reader
 *
 * P2-13（第二轮审计）：release-smoke 原用 `unzip -l` 校验发布 zip，Windows
 * 默认无 unzip → 发版门禁在本机必红（且静默依赖外部命令）。改为直接解析
 * zip 的 End of Central Directory + Central Directory（固定结构、无压缩算法
 * 依赖，也不需 zlib）——零外部命令、零依赖、跨平台。
 * 仅支持普通 zip（不支持 ZIP64：本项目发布包远小于 4GB / 65535 条目，超出时
 * 抛错而不是静默给出不完整列表）。
 * Reads entry names straight from the zip central directory — no external
 * `unzip`, no dependencies. ZIP64 is rejected explicitly (release zip is tiny).
 */

/**
 * 读取 zip 内全部条目名（含目录条目）。
 * Return every entry name in the zip (directory entries included).
 * @param {Buffer} buf - zip 文件内容 / zip file bytes
 * @returns {string[]}
 */
export function listZipEntries(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('zip 数据过短');
  const eocdOffset = findEocd(buf);
  if (eocdOffset < 0) throw new Error('未找到 zip End of Central Directory（文件损坏或非 zip）');
  const count = buf.readUInt16LE(eocdOffset + 10);
  const cdSize = buf.readUInt32LE(eocdOffset + 12);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    throw new Error('zip 为 ZIP64 格式（本脚本不支持）');
  }
  if (cdOffset + cdSize > buf.length) throw new Error('zip central directory 越界（文件被截断）');

  const names = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) {
      throw new Error(`zip central directory 条目 ${i} 签名错误`);
    }
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    names.push(buf.toString('utf8', p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

/**
 * 从尾部向前查找 EOCD 签名（注释最长 65535 字节）。
 * Locate the EOCD record scanning backwards (comment can be up to 65,535 bytes).
 * @param {Buffer} buf
 * @returns {number} EOCD 起始偏移；未找到返回 -1 / offset or -1
 */
function findEocd(buf) {
  const minStart = Math.max(0, buf.length - 22 - 0xffff);
  for (let p = buf.length - 22; p >= minStart; p--) {
    if (buf.readUInt32LE(p) === 0x06054b50) return p;
  }
  return -1;
}
