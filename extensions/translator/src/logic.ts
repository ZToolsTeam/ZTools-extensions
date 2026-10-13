/**
 * ZTools 多语言翻译核心逻辑 (离线词典 + 智能语种检测 + 纯函数)
 */

export interface TranslationDefinition {
  pos: string; // 词性: n. / v. / adj. / adv.
  meaning: string;
}

export interface TranslationResult {
  sourceText: string;
  translatedText: string;
  sourceLang: string;
  targetLang: string;
  phonetic?: string;
  definitions?: TranslationDefinition[];
  examples?: Array<{ source: string; target: string }>;
}

export interface TranslationHistoryItem {
  id: string;
  sourceText: string;
  translatedText: string;
  sourceLang: string;
  targetLang: string;
  timestamp: number;
}

// 离线内置核心词典数据库 (常见词汇、开发术语、高频日常短语)
const OFFLINE_DICTIONARY: Record<
  string,
  {
    translation: string;
    phonetic?: string;
    definitions?: TranslationDefinition[];
    examples?: Array<{ source: string; target: string }>;
  }
> = {
  hello: {
    translation: "你好，问候",
    phonetic: "/həˈləʊ/",
    definitions: [
      { pos: "int.", meaning: "喂；你好" },
      { pos: "n.", meaning: "表示问候或惊奇的声音" }
    ],
    examples: [{ source: "Hello world!", target: "你好，世界！" }]
  },
  world: {
    translation: "世界，地球，领域",
    phonetic: "/wɜːld/",
    definitions: [
      { pos: "n.", meaning: "地球；世界；全人类" }
    ],
    examples: [{ source: "All around the world.", target: "全世界。" }]
  },
  declarative: {
    translation: "声明式的，陈述的",
    phonetic: "/dɪˈklær.ə.tɪv/",
    definitions: [
      { pos: "adj.", meaning: "声明性的；陈述的" },
      { pos: "n.", meaning: "陈述句" }
    ],
    examples: [{ source: "Declarative UI framework.", target: "声明式 UI 框架。" }]
  },
  component: {
    translation: "组件，成分，部件",
    phonetic: "/kəmˈpəʊ.nənt/",
    definitions: [
      { pos: "n.", meaning: "组成部分；组件；元件" },
      { pos: "adj.", meaning: "组成的；构成的" }
    ],
    examples: [{ source: "Reusable UI components.", target: "可复用的 UI 组件。" }]
  },
  performance: {
    translation: "性能，表现，执行",
    phonetic: "/pəˈfɔː.məns/",
    definitions: [
      { pos: "n.", meaning: "性能；工作情况；执行；表现" }
    ],
    examples: [{ source: "High performance system.", target: "高性能系统。" }]
  },
  developer: {
    translation: "开发者，程序员",
    phonetic: "/dɪˈvel.ə.pər/",
    definitions: [
      { pos: "n.", meaning: "开发者；开发人员" }
    ],
    examples: [{ source: "Developer first ecosystem.", target: "开发者第一生态。" }]
  },
  architecture: {
    translation: "架构，体系结构",
    phonetic: "/ˈɑː.kɪ.tek.tʃər/",
    definitions: [
      { pos: "n.", meaning: "体系结构；架构；建筑学" }
    ],
    examples: [{ source: "Clean software architecture.", target: "整洁的软件架构。" }]
  },
  "你好": {
    translation: "Hello / Hi",
    phonetic: "nǐ hǎo",
    definitions: [{ pos: "int.", meaning: "用于问候的标准敬语" }],
    examples: [{ source: "你好，朋友！", target: "Hello, my friend!" }]
  },
  "世界": {
    translation: "World",
    phonetic: "shì jiè",
    definitions: [{ pos: "n.", meaning: "地球上全部人类社会的总和" }],
    examples: [{ source: "探索未知世界。", target: "Explore the unknown world." }]
  },
  "开源": {
    translation: "Open Source",
    phonetic: "kāi yuán",
    definitions: [{ pos: "adj.", meaning: "开放源代码的" }],
    examples: [{ source: "纯粹的开源软件生态。", target: "Pure open source software ecosystem." }]
  },
  "计算器": {
    translation: "Calculator",
    phonetic: "jì suàn qì",
    definitions: [{ pos: "n.", meaning: "用于数学计算的电子或机械工具" }]
  },
  "待办事项": {
    translation: "Todo / Task List",
    phonetic: "dài bàn shì xiàng",
    definitions: [{ pos: "n.", meaning: "待完成的工作或事务列表" }]
  },
  "时间戳": {
    translation: "Timestamp",
    phonetic: "shí jiān chuāng",
    definitions: [{ pos: "n.", meaning: "记录时间的数据标记" }]
  },
  "谢谢": {
    translation: "Thank you / Thanks",
    phonetic: "xiè xie",
    definitions: [{ pos: "int.", meaning: "对他人关照或帮助表示感谢" }]
  }
};

export const TRANSLATION_ENDPOINT = "https://ai.api.360qnw.com/api/oauth/translation";

export interface LanguageOption {
  code: string;
  name: string;
  flag: string;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: "zh", name: "中文(简体)", flag: "🇨🇳" },
  { code: "en", name: "英语", flag: "🇺🇸" },
  { code: "jp", name: "日语", flag: "🇯🇵" },
  { code: "kor", name: "韩语", flag: "🇰🇷" },
  { code: "fra", name: "法语", flag: "🇫🇷" },
  { code: "de", name: "德语", flag: "🇩🇪" },
  { code: "spa", name: "西班牙语", flag: "🇪🇸" },
  { code: "ru", name: "俄语", flag: "🇷🇺" }
];

export function toApiLang(code: string): string {
  const map: Record<string, string> = {
    "zh-CN": "zh",
    "zh": "zh",
    "en": "en",
    "ja": "jp",
    "jp": "jp",
    "ko": "kor",
    "kor": "kor",
    "fr": "fra",
    "fra": "fra",
    "de": "de",
    "es": "spa",
    "spa": "spa",
    "ru": "ru"
  };
  return map[code] || code;
}

/**
 * 智能探测文本语言类型
 */
export function detectLanguage(text: string): "zh" | "en" | "ja" | "ko" {
  const trimmed = text.trim();
  if (/[\u4e00-\u9fa5]/.test(trimmed)) {
    return "zh";
  }
  if (/[\u3040-\u30ff]/.test(trimmed)) {
    return "ja";
  }
  if (/[\uac00-\ud7af]/.test(trimmed)) {
    return "ko";
  }
  return "en";
}

/**
 * 真实异步联网翻译 (对齐 ZTools 官方翻译服务端)
 */
export async function fetchLiveTranslation(
  text: string,
  targetLang: string = "zh",
  signal?: AbortSignal
): Promise<TranslationResult> {
  const source = (text || "").trim();
  if (!source) {
    return {
      sourceText: "",
      translatedText: "",
      sourceLang: "auto",
      targetLang: "auto"
    };
  }

  const detected = detectLanguage(source);
  const effectiveTarget = toApiLang(targetLang || (detected === "zh" ? "en" : "zh"));
  const lower = source.toLowerCase();
  const directMatch = OFFLINE_DICTIONARY[lower] || OFFLINE_DICTIONARY[source];

  // 构造真实后端 POST 请求
  const formData = new FormData();
  formData.append("query", source);
  formData.append("lang", "auto");
  formData.append("tolang", effectiveTarget);

  try {
    const res = await fetch(TRANSLATION_ENDPOINT, {
      method: "POST",
      body: formData,
      signal
    });

    if (res.ok) {
      const json = await res.json();
      if (json && json.code === 0 && json.data?.trans_result?.length > 0) {
        const translated = json.data.trans_result.map((i: any) => i.dst).join("\n");
        const detectedFrom = json.data.from || detected;
        return {
          sourceText: source,
          translatedText: translated,
          sourceLang: detectedFrom,
          targetLang: effectiveTarget,
          phonetic: directMatch?.phonetic,
          definitions: directMatch?.definitions || [
            { pos: "trans", meaning: `在线高精度翻译 · 已成功连接云端` }
          ],
          examples: directMatch?.examples || [
            { source, target: translated }
          ]
        };
      }
    }
  } catch (err: any) {
    if (signal?.aborted) throw err;
  }

  return translateText(source, effectiveTarget);
}

/**
 * 执行即时本地/离线翻译
 */
export function translateText(text: string, overrideTargetLang?: string): TranslationResult {
  const source = (text || "").trim();
  if (!source) {
    return {
      sourceText: "",
      translatedText: "",
      sourceLang: "auto",
      targetLang: "auto"
    };
  }

  const detected = detectLanguage(source);
  const targetLang = overrideTargetLang || (detected === "zh" ? "en" : "zh");

  const lower = source.toLowerCase();
  const directMatch = OFFLINE_DICTIONARY[lower] || OFFLINE_DICTIONARY[source];

  if (directMatch) {
    return {
      sourceText: source,
      translatedText: directMatch.translation,
      sourceLang: detected,
      targetLang,
      phonetic: directMatch.phonetic,
      definitions: directMatch.definitions,
      examples: directMatch.examples
    };
  }

  // 本地离线备选
  return {
    sourceText: source,
    translatedText: source,
    sourceLang: detected,
    targetLang,
    phonetic: `[${detected} ➔ ${targetLang}]`,
    definitions: [{ pos: "waiting", meaning: `正在连接在线翻译引擎...` }]
  };
}
