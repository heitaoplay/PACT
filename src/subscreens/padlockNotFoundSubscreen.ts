import { BaseSubscreen } from "zois-core/ui";
import { t as getText } from "src/modules/i18n";

/**
 * 当检查锁时拿不到锁配置（未同步 / 数据损坏 / 非本插件锁）时显示，
 * 避免空白界面且无法退出。BaseSubscreen 会自动创建退出按钮并支持 ESC。
 */
export class PadlockNotFoundSubscreen extends BaseSubscreen {
    private readonly groupName: string;

    constructor(groupName: string) {
        super();
        this.groupName = groupName;
    }

    public get name(): string {
        return getText("common.inspect_padlock");
    }

    public onLoad(): void {
        this.createText({
            text: getText("common.padlock_not_synced_title"),
            x: 60,
            y: 180,
            width: 600,
            height: 60
        });

        this.createText({
            text: getText("common.padlock_not_synced_body", { group: this.groupName }),
            x: 60,
            y: 260,
            width: 620,
            height: 160
        });
    }

    public onExit(): void {
        if (ChatRoomData !== null) CommonSetScreen("Online", "ChatRoom");
        else CommonSetScreen("Room", "MainHall");
    }
}
