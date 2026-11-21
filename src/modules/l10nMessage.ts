/**
 * 锁契 · PACT — 按接收方语言显示的聊天动作消息（L10N 占位符模式）
 *
 * 原理（参考 bc-script-dev §6 的 GGC L10N 方案）：
 * - 发送时：消息含一个隐藏 Dictionary 标签 PACT_L10N，装 { tag, data }；
 *   同时带 fallback 文本（发送方语言），给没装插件的客户端兜底显示。
 * - 接收端：hook ChatRoomMessage，检测到 PACT_L10N 标签，
 *   把显示文本用当前客户端语言 t(tag, data) 重写。
 * - 没装插件的客户端：看不到 PACT_L10N 的含义，直接显示 fallback，可读。
 *
 * 这样一条消息，中文玩家看中文、英文玩家看英文，互通且无兼容问题。
 */
import { hookFunction, HookPriority } from "zois-core/mod-sdk";
import { t } from "src/modules/i18n";

const L10N_TAG = "PACT_L10N";

/** 发送一条"按各客户端语言显示"的动作消息 */
export function sendLocalizedAction(tag: string, replacements: Record<string, string | number> = {}): void {
    if (!ServerPlayerIsInChatRoom()) return;

    // 发送方语言的兜底文本（没装插件的人看到这个）
    const fallback = t(tag, replacements);
    const payload = JSON.stringify({ tag, data: replacements });

    // BC 的 ServerSend 类型定义把 payload 限制为 never（重载推断问题），运行时实际接受任意对象
    const serverSend = ServerSend as (message: string, payload: unknown) => void;
    serverSend("ChatRoomChat", {
        Content: "Beep",
        Type: "Action",
        Dictionary: [
            // 让各语言的 Beep 前缀都替换成 msg，避免显示"发送私聊"前缀
            { Tag: "Beep", Text: "msg" },
            { Tag: "发送私聊", Text: "msg" },
            { Tag: "Biep", Text: "msg" },
            { Tag: "Sonner", Text: "msg" },
            { Tag: "Звуковой сигнал", Text: "msg" },
            { Tag: "msg", Text: fallback },
            // 我们自己的 L10N 载荷
            { Tag: L10N_TAG, ns: "pact", data: payload }
        ]
    });
}

/** 在检查/解锁界面安装接收端重写 hook（只装一次） */
let hookInstalled = false;
export function installL10NMessageHook(): void {
    if (hookInstalled) return;
    hookInstalled = true;

    hookFunction("ChatRoomMessage", HookPriority.ADD_BEHAVIOR, (args, next) => {
        const data = args[0] as ServerChatRoomMessage | undefined;
        const dictionary = data?.Dictionary as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(dictionary)) {
            const l10n = dictionary.find(
                (d) => d?.Tag === L10N_TAG && typeof d.data === "string"
            );
            if (l10n) {
                try {
                    const parsed = JSON.parse(l10n.data as string) as { tag: string; data: Record<string, string | number> };
                    const localized = t(parsed.tag, parsed.data);
                    // BC 把 Dictionary 里 Tag="msg" 的 Text 作为最终显示文本，
                    // 这里按接收方语言覆盖它
                    const msgEntry = dictionary.find(
                        (d) => d?.Tag === "msg" && typeof d.Text === "string"
                    );
                    if (msgEntry) msgEntry.Text = localized;
                } catch (e) {
                    // 解析失败就保留 fallback，不影响显示
                }
            }
        }
        return next(args);
    });
}
