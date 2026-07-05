// 所有类型从 Zod Schema 自动派生，无需手动维护
export type { TtsRequest } from '../schemas/tts.schema.js';
export type { Chapter, NovelRequest, NovelResponse, ChapterResult } from '../schemas/novel.schema.js';
export type { VoiceInfo, VoicesResponse } from '../schemas/voice.schema.js';
export type { Config } from '../schemas/config.schema.js';
export type { AudioFormat, Emotion, VoiceId } from '../schemas/common.schema.js';
export type { CharacterPortrait, CharacterAnalysisResult } from '../schemas/character.schema.js';
export type { SpeakerProfile } from '../services/speaker_manager.js';
