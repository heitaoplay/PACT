import pactEmblemImage from "images/pact-pact-emblem.png";
import { MainSubscreen } from "subscreens/mainSubscreen";
import { getCurrentSubscreen, setSubscreen } from "zois-core/ui";


export function loadSettingsMenu(): void {
	PreferenceRegisterExtensionSetting({
		Identifier: "DOGS",
		ButtonText: "锁契 · PACT 设置",
		Image: pactEmblemImage,
		click: () => {
			getCurrentSubscreen()?.click();
		},
		run: () => {
			getCurrentSubscreen()?.run();
		},
		resize: () => {
			getCurrentSubscreen()?.resize();
		},
		exit: () => false,
		load: () => {
			setSubscreen(new MainSubscreen());
		}
	});
}
