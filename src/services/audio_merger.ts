import { logger } from '../utils/logger.js';

export class AudioMerger {
  /**
   * 将多个音频 Buffer 按顺序拼接为一个完整音频
   */
  async merge(audioBuffers: Buffer[], format: 'wav' | 'mp3' | 'pcm'): Promise<Buffer> {
    // TODO: 使用 fluent-ffmpeg 或 wav-concat 实现拼接
    logger.info('合并音频片段', { count: audioBuffers.length, format });
    throw new Error('AudioMerger.merge 尚未实现');
  }
}

export const audioMerger = new AudioMerger();
