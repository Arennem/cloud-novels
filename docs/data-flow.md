# 数据流

> 四个核心流程：小说标题映射、大模型角色分析、角色声音生成、批量合成

---

## 一、小说标题 → novel_id 映射

客户端只传中文标题，服务端保证稳定映射。

```
POST /novel/convert  { novel_title: "星辰大海", ... }
    │
NovelManager.getOrCreate("星辰大海")
    ├─ SELECT → 有记录 → 返回已有 novel_id
    └─ INSERT → 无记录 → 生成新 UUID → 返回
```

---

## 二、大模型角色分析（新增核心环节）

不再靠猜名字选音色——让大模型读完小说，理解每个角色是谁。

```
小说文本（所有章节）
    │
    ▼
CharacterAnalyzer.analyze(chapters)
    │
    ├─ 构建 prompt，发送给 通义千问（qwen-max）
    │  ┌─────────────────────────────────────────────┐
    │  │ System: 你是一个专业的小说角色分析专家...    │
    │  │ User:   请分析以下小说文本中所有角色的特征... │
    │  │         第1章 相遇                          │
    │  │         日落西山。                          │
    │  │         [林远]你到底是谁？                  │
    │  │         [苏晴]我不会告诉你的。              │
    │  └─────────────────────────────────────────────┘
    │
    ▼
大模型返回结构化 JSON：
{
  "characters": [
    {
      "name": "林远",
      "gender": "male",
      "age": "二十二岁",
      "height": "178cm",
      "build": "健壮",
      "personality": ["沉稳", "果断", "温柔"],
      "voice_description": "低沉浑厚的青年男声，略带磁性，语气沉稳有力",
      "speaking_style": "语速中等，吐字清晰，干脆利落",
      "backstory_summary": "武林世家传人，为人正直..."
    },
    {
      "name": "苏晴",
      "gender": "female",
      "age": "十九岁",
      "voice_description": "清脆悦耳的少女声，音色明亮纯净，带着一丝俏皮"
    }
  ]
}
    │
    ▼
画像传入 SpeakerManager，指导声音生成
```

### 分析依据

大模型从以下维度推断角色特征：

| 维度 | 分析来源 |
|---|---|
| **性别** | 角色的台词风格、其他角色的称呼（"林公子"/"苏姑娘"）、作者旁白 |
| **年龄** | 台词中透露的年龄信息、角色间的辈分关系、行为方式 |
| **身高体态** | 作者对角色外形的直接描写、其他角色的视角描述 |
| **性格** | 台词语气、行为选择、其他角色的评价、故事情节 |
| **声音** | 综合分析所有特征后推断最贴合角色的声线 |

---

## 三、角色声音自动生成

```
角色画像（来自大模型）
    │
    ▼
SpeakerManager.getOrCreateSpeaker(novel_id, "林远", portrait)
    │
    ├─ 查 SQLite → 已有 → 复用
    │
    └─ 无缓存 → 生成新声音
       │
       ├─ ① 选 base voice
       │      portrait.gender === "male" → 从男声池轮询
       │      └─ "longfei"（龙飞）
       │
       ├─ ② 构建声音 prompt
       │      characterAnalyzer.buildVoicePrompt(portrait)
       │      └─ "低沉浑厚的青年男声，略带磁性，语气沉稳有力，说话时语速中等"
       │
       ├─ ③ 调用 CosyVoice instruct TTS
       │      用 "longfei" 音色 + prompt → "低沉浑厚的青年男声说：你好，我是林远。"
       │      生成参考语音
       │
       ├─ ④ 提取 speaker embedding → speaker_id
       │
       ├─ ⑤ INSERT INTO speakers (novel_id, "林远", portrait, speaker_id)
       │
       └─ ⑥ 返回 SpeakerProfile
    │
    ▼
后续每句 [林远]xxx → 零样本合成 → 声音完全一致
```

### 声音一致性保障链条

```
大模型画像（声线描述固定）
    → 生成的 reference prompt 每次一样
    → 同一 base voice
    → speaker embedding 相同
    → 输出声音 100% 一致
```

---

## 四、批量合成完整流程

```
客户端 POST /novel/convert
  { novel_title: "星辰大海", chapters: [...], character_descriptions?: {...} }
    │
    ▼
【第 1 步】小说映射
  novelManager.getOrCreate("星辰大海")
  └─ 返回 stable novel_id
    │
    ▼
【第 2 步】大模型分析角色
  characterAnalyzer.analyze({ chapters, existingCharacters })
  └─ 返回角色画像列表
  └─ 与 character_descriptions（用户提供的手动描述）合并
    │
    ▼
【第 3 步】注册角色声音
  for each (角色名, 画像):
    speakerManager.getOrCreateSpeaker(novelId, 角色名, 画像)
    └─ 查 DB → 有缓存复用 / 无缓存按画像 AI 生成声音
    │
    ▼
【第 4 步】逐句合成
  for each 章节:
    chunks = textSplitter.parseRoles(content)
    for each chunk:
      profile = speakerManager.getSpeaker(chunk.role / 旁白)
      audio = cosyvoiceService.synthesizeWithSpeaker(chunk.text, profile.speakerId)
    chapterAudio = audioMerger.merge(chunks, format)
    │
    ▼
【第 5 步】响应
  { task_id, status, novel_id, chapters, characters_registered, character_analysis }
```

---

## 五、多角色文本格式

```
日落西山，小镇笼罩在金色的余晖中。
[林远]你到底是谁？
[苏晴]我不会告诉你的。
[林远]告诉我，我不会伤害你。
```

- 无标记行 → 旁白（默认音色）
- [角色名] 文本 → 查该角色的 speaker_id
- 角色可以携带 `character_descriptions` 辅助大模型分析

---

## 六、兜底策略

大模型分析不是强依赖。以下情况会自动降级：

| 情况 | 行为 |
|---|---|
| `DASHSCOPE_API_KEY` 未配置 | 跳过 LLM 分析，fallback 到角色名猜性别选音色 |
| 大模型 API 调用失败 | 同上，不影响主流程 |
| LLM 未分析到某个角色 | 如果有 `character_descriptions` 则用描述，否则默认 |
| 角色已经在 DB 中有缓存 | 直接复用，不再调大模型 |
| 角色名用字偏中性 | 从全部音色池轮询分配 |
