/**
 * 锁契 · PACT 的 i18n 层。
 *
 * zois-core 的 getText 硬读游戏全局变量 TranslationLanguage，且无 setLocale。
 * 这里自己管理 7 个语言包，支持两种模式：
 *   - auto（默认）：跟随玩家登录 BC 时选择的语言
 *   - 手动覆盖：在插件设置里指定，不影响游戏和其它插件
 *
 * 用法：把 `import { getText } from "zois-core/localization"` 换成
 *       `import { t as getText } from "src/modules/i18n"`，调用点写法不变。
 */
import { LOCALIZATION_BASE_URL } from "src/constants";
import { getText as zoisGetText } from "zois-core/localization";

export const PACT_LOCALES = ["cn", "en", "fr", "de", "ru", "tw", "ua"] as const;
export type PactLocale = typeof PACT_LOCALES[number];

export const LOCALE_LABELS: Record<string, string> = {
    auto: "跟随游戏语言",
    cn: "简体中文",
    tw: "繁體中文",
    en: "English",
    fr: "Français",
    de: "Deutsch",
    ru: "Русский",
    ua: "Українська"
};

// 由外部注入：读取用户选择的覆盖语言（"auto" 或具体代码）
let overrideGetter: () => string | undefined = () => undefined;
export function setLocaleOverrideGetter(getter: () => string | undefined): void {
    overrideGetter = getter;
}

// 语言包缓存
const cache: Record<string, Record<string, unknown>> = {};

function getNestedValue(obj: Record<string, unknown> | undefined, path: string): string | undefined {
    if (!obj || !path) return undefined;
    let current: unknown = obj;
    for (const key of path.split(".")) {
        if (current && typeof current === "object" && key in (current as Record<string, unknown>)) {
            current = (current as Record<string, unknown>)[key];
        } else {
            return undefined;
        }
    }
    return typeof current === "string" ? current : undefined;
}

function processReplacements(text: string, replacements?: Record<string, string | number>): string {
    if (!replacements) return text;
    let result = text;
    for (const [key, value] of Object.entries(replacements)) {
        result = result.replaceAll("$" + key, String(value));
    }
    return result;
}

/** 当前生效语言：用户覆盖优先，否则跟随游戏，最后回退 cn */
export function currentLocale(): string {
    const override = overrideGetter();
    if (override && override !== "auto" && (PACT_LOCALES as readonly string[]).includes(override)) {
        return override;
    }
    const gameLang = String(TranslationLanguage || "EN").toLowerCase();
    return (PACT_LOCALES as readonly string[]).includes(gameLang) ? gameLang : "cn";
}

/** 异步加载语言包（启动时调用，不阻塞） */
export async function loadLocales(): Promise<void> {
    // 基础包 cn 必载；其余按当前语言与覆盖值载
    const wanted = new Set<string>(["cn", currentLocale()]);
    // 语言切换器下拉里列出的语言，预载以便切换即时生效
    for (const locale of wanted) {
        if (cache[locale]) continue;
        try {
            const response = await fetch(`${LOCALIZATION_BASE_URL}/${locale}.json?=${Date.now()}`);
            if (response.ok) cache[locale] = await response.json();
        } catch (e) {
            // 静默失败，取文案时会回退到 cn
        }
    }
}

/**
 * 切换语言后重新加载对应包（下拉菜单选择时调用）。
 */
export async function switchLocale(locale: string): Promise<void> {
    if (cache[locale]) return;
    try {
        const response = await fetch(`${LOCALIZATION_BASE_URL}/${locale}.json?=${Date.now()}`);
        if (response.ok) cache[locale] = await response.json();
    } catch (e) { /* 回退 cn */ }
}

/** 取文案。签名与 zois-core getText 一致。 */
export function t(tag: string, replacements?: Record<string, string | number>): string {
    const locale = currentLocale();
    // 优先从自己的缓存取（支持手动覆盖语言）
    const value = getNestedValue(cache[locale], tag) ?? getNestedValue(cache["cn"], tag);
    if (value) return processReplacements(value, replacements);
    // 自己的语言包还没加载完时，回退到 zois-core 原生 getText
    // （它会在 bootstrap 阶段加载 default=cn 包），避免界面出现 key 字符串
    return zoisGetText(tag, replacements);
}
