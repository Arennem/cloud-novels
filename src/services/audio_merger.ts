import { logger } from '../utils/logger.js';

const WAV_HEADER_SIZE = 44;

export class AudioMerger {
  /**
   * 将多个音频 Buffer 按顺序拼接为一个完整音频
   *
   * - WAV: 只保留第一段的 WAV 头，后续段去掉头部后拼接 PCM 数据，再修正总长度
   * - MP3: 直接拼接（MPEG 流式格式，相同编码的片段可直接合并）
   * - PCM: 直接拼接（纯裸数据）
   */
  async merge(audioBuffers: Buffer[], format: 'wav' | 'mp3' | 'pcm'): Promise<Buffer> {
    if (audioBuffers.length === 0) {
      throw new Error('没有音频片段可以合并');
    }
    if (audioBuffers.length === 1) {
      return audioBuffers[0];
    }

    logger.info('合并音频片段', { count: audioBuffers.length, format });

    switch (format) {
      case 'wav':
        return this.mergeWav(audioBuffers);
      case 'mp3':
        return this.mergeRaw(audioBuffers);
      case 'pcm':
        return this.mergeRaw(audioBuffers);
      default:
        throw new Error(`不支持的音频格式: ${format}`);
    }
  }

  /**
   * 合并 WAV 文件：保留第一段头部，后续段去掉 44 字节头部后拼接
   */
  private mergeWav(buffers: Buffer[]): Buffer {
    const first = buffers[0];
    if (first.length < WAV_HEADER_SIZE) {
      throw new Error('无效的 WAV 数据：不足 44 字节头部');
    }

    const header = first.subarray(0, WAV_HEADER_SIZE);
    const chunks: Buffer[] = [header];

    // 第一段的数据部分
    chunks.push(first.subarray(WAV_HEADER_SIZE));

    // 后续段去掉头部
    for (let i = 1; i < buffers.length; i++) {
      const buf = buffers[i];
      if (buf.length <= WAV_HEADER_SIZE) {
        logger.warn(`第 ${i + 1} 段 WAV 数据过短，跳过`);
        continue;
      }
      chunks.push(buf.subarray(WAV_HEADER_SIZE));
    }

    const result = Buffer.concat(chunks);

    // 修正 WAV 头中的文件总大小（从第 4 字节开始的 4 字节小端整数）
    const dataSize = result.length - WAV_HEADER_SIZE;
    result.writeUInt32LE(dataSize, 4);       // RIFF chunk size
    result.writeUInt32LE(dataSize, 40);      // data chunk size

    return result;
  }

  /**
   * 直接拼接（MP3 / PCM）
   */
  private mergeRaw(buffers: Buffer[]): Buffer {
    return Buffer.concat(buffers);
  }
}

export const audioMerger = new AudioMerger();
