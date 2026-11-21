import "reflect-metadata";
import { initStorage, modStorage, syncStorage } from "modules/storage";
import { loadRemoteControl } from "modules/remoteControl";
import { loadSettingsMenu } from "modules/settingsMenu";
import { loadDeviousPadlock } from "modules/deviousPadlock";
import { isVersionNewer, bootstrap, ModData, waitFor, MOD_DATA } from "zois-core";
import { toastsManager } from "zois-core/toasts";
import { messagesManager } from "zois-core/messaging";
import { version } from "../package.json";
import { DeviousPadlockSubscreen } from "./subscreens/deviousPadlockSubscreen";
import { MainSubscreen } from "subscreens/mainSubscreen";
import { RemoteControlSubscreen } from "subscreens/remoteControlSubscreen";
import { ProfilesSubscreen } from "subscreens/profilesSubscreen";
import { GITHUB_REPO_URL, LOCALIZATION_BASE_URL } from "./constants";
import { loadDialogs } from "modules/dialogs";
import { logger } from "zois-core/logging";
import { getText } from "zois-core/localization";
import changelog from "../changelog.json";

let hasInitialized = false;

bootstrap({
    name: "锁契 · PACT",
    fullName: "Padlock Authorization & Covenant Toolkit",
    key: "DOGS",
    version,
    repository: GITHUB_REPO_URL,
    fontFamily: CommonGetFontName(),
    subscreens: {
        DeviousPadlockSubscreen,
        ProfilesSubscreen,
        MainSubscreen,
        RemoteControlSubscreen
    },
    localization: {
        locales: {
            default: "zh-CN",
            supported: ["zh-CN", "en", "ru"]
        },
        translationsFolderPath: IS_DEV ? `http://localhost:8000/localization` : LOCALIZATION_BASE_URL
    },
    changelog: {
        data: changelog as NonNullable<ModData["changelog"]>["data"]
    },
    onReady: initializePACT
});

function initializePACT(): void {
    if (hasInitialized) return;
    hasInitialized = true;

    initStorage();
    loadSettingsMenu();
    loadDialogs();
    loadRemoteControl();
    void loadDeviousPadlock().catch((error) => {
        logger.error("锁契：挂锁模块初始化失败", error);
    });
    logger.log(`Ready! v${version}`);
    toastsManager.success({
        title: getText(`toasts.mod_loaded`, { name: "锁契 · PACT" }),
        message: `v${version}`,
        duration: 4000
    });

    // 更新提示：改为指向我们自己的仓库，不再硬编码外国作者的版本链接
    if (isVersionNewer(MOD_DATA.version, modStorage.version)) {
        waitFor(() => !!document.getElementById("InputChat")).then(() => {
            modStorage.version = version;
            syncStorage();
            messagesManager.sendLocal(getText("toasts.mod_updated"));
        });
    }
}




