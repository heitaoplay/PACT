// ── 双锁体系 ─────────────────────────────────────────────────────────────
// 兼容锁：保留狗锁的物品名，只改 UI（中文名 + 我们图标），保证与狗锁玩家互通
export const COMPAT_PADLOCK_NAME = "DeviousPadlock";
// 锁契自有锁：全新物品名，属于我们自己的锁体系
export const PACT_PADLOCK_NAME = "PactPadlock";
// 判断某个物品名是否是我们认识的两把锁之一
export function isKnownPadlockName(name: string | undefined | null): boolean {
	return name === COMPAT_PADLOCK_NAME || name === PACT_PADLOCK_NAME;
}

export const GITHUB_REPO_URL = "https://github.com/heitaoplay/PACT";
export const LOCALIZATION_BASE_URL = "https://heitaoplay.github.io/PACT/localization";

export const KNOWN_CHEAT_COMMANDS = [
    "/release", "/totalrelease", "/quit", "/wardrobe", "/boost", "/infolock", "/removecollar", "/resetdifficulty",
    "/safeworditem", "/solidity", "/unlock", "/untie"
];
export const DEVIOUS_PADLOCK_ITEM_PROPERTIES_TO_COMPARE: (keyof ItemProperties)[] = [
    "TypeRecord", "LockMemberName", "OverridePriority", "PunishOrgasm", "PunishStandup", "PunishStruggle",
    "PunishStruggleOther", "ShockLevel", "ShowText", "TriggerValues", "InflateLevel", "Intensity"
];
export const DEVIOUS_PADLOCK_MARKER = "\u200b";
// 频繁重现阈值：20 秒内超过 8 次判定为异常循环，触发 2 分钟暂停保护。
// 原版为 12，拿铁版降到 4 过敏感（正常换装易误触发），这里取 8 折中。
export const DEVIOUS_PADLOCK_MAX_TRIGGER_COUNT = 8;
export const DEVIOUS_PADLOCK_MINIMUM_FIRST_TRIGGER_INTERVAL = 1000 * 20;
export const DEVIOUS_PADLOCK_COOLDOWN_TIME = 1000 * 60 * 2;
export const CRAFTING_PARTIAL_KEYS = [
	"Name",
	"MemberName",
	"MemberNumber",
	"Description",
	"Effects",
	"Private",
] as const;
