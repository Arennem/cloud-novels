# Cloud Novels 项目规则

> **遵从声明**：每次代码开发时，无论命中下面哪条规则，我都将明确声明"我将遵守 XXX 规则进行代码开发"，表明本次修改遵循了哪些规则约束。
## 1. 单文件代码行数

- 每个 `.ts` 文件不超过 **400 行**（不含空行和类型定义）。
- 超过 400 行时，必须拆分为独立文件——例如将工具函数提取到 `src/utils/`，或将一个类拆成多个文件。
- 单函数不超过 **40 行**，超过时拆成若干小函数。
- schema 文件中的 Zod Schema 定义以及类型编排不算在行数限制中。

## 2. 代码逻辑复用

- 相似的逻辑必须提取为共享函数或类，禁止复制粘贴后改参数。
- 提取的公共函数放在 `src/utils/` 下，例如 `src/utils/file.ts` 这样的风格。
- 如果一个工具函数在 3 个以上文件中被引用，应当加入 `src/utils/`。
- DB 查询逻辑封装在 `src/db/` 中，其他模块通过 `getDb()` 获取 db 实例，不直接拼 SQL。
- 服务层（`src/services/`）的类实例以单例模式导出，沿用现有风格：
  ```ts
  export const xxxService = new XxxService();
  ```

## 3. 公共代码资源放置位置

| 类别 | 路径 | 说明 |
|------|------|------|
| 工具函数 | `src/utils/` | 纯函数、文件操作、字符串处理等 |
| 日志 | `src/utils/logger.ts` | 统一日志入口 |
| 类型定义 | `src/types/index.ts` | 只做 re-export，具体类型由 Zod schema 或服务层定义 |
| Zod Schema | `src/schemas/` | 所有输入校验和类型推导的源头，不要手动定义重复类型 |
| 数据库层 | `src/db/` | schema 定义 + 初始化 + 查询封装 |
| 路由 | `src/routes/` | Fastify 路由注册，只做参数校验和响应编排 |
| 服务层 | `src/services/` | 业务逻辑，可被路由和控制器调用 |
| 配置 | `src/config.ts` | 读取环境变量并通过 Zod Schema 校验 |

## 4. 文件命名

- 全部使用 **kebab-case**（短横线分隔），例如 `speaker_manager.ts`、`text_splitter.ts`。
- 测试文件与被测文件同名，后缀加 `.test.ts`，例如 `speaker_manager.test.ts`。
- Schema 文件用 `.schema.ts` 后缀，如 `novel.schema.ts`。
- 类型文件尽量放到对应模块中，不要为了类型单独建文件，除非是跨模块共享的编排类型（放在 `src/types/index.ts`）。

## 5. 函数命名

- **函数名：camelCase**。动词开头，例如 `getOrCreateSpeaker()`、`ensureDir()`、`extractCharacters()`。
- **类名：PascalCase**。例如 `SpeakerManager`、`TextSplitter`、`CosyVoiceService`。
- **布尔返回值函数/变量** 用 `isXxx`、`hasXxx`、`shouldXxx` 前缀，例如 `shouldLog()`。
- **私有方法名** 与公开方法一致（camelCase），不额外加下划线前缀。
- 导出的单例变量名与类名对应，首字母小写，如 `cosyvoiceService`、`textSplitter`。
- 回调/事件处理器函数名用 `handleXxx` 前缀，例如 `handleConnection`。

## 6. 通用编码约束

- 所有文件使用 **ESM**，导入路径必须带 `.js` 后缀，例如 `import { config } from './config.js'`。
- 避免在代码中使用 `require()`。
- 不要直接使用 `console.log`，统一通过 `logger.info` / `warn` / `error` / `debug` 输出。
- 新增功能必须编写对应的 Zod Schema 做输入校验。
- 所有路由处理函数使用 `async` 风格。
- 删除或废弃代码直接删，不要注释掉留作"备份"。

