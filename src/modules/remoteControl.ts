import { modStorage } from "./storage";
import { getNickname } from "zois-core";
import { hookFunction, HookPriority } from "zois-core/mod-sdk";
import { messagesManager } from "zois-core/messaging";
import { toastsManager } from "zois-core/toasts";
import { t as getText } from "src/modules/i18n";
import { sendLocalizedAction } from "src/modules/l10nMessage";


export let remoteControlIsInteracting: boolean = false;
export const setRemoteControlIsInteracting = (value: boolean) => remoteControlIsInteracting = value;
export const remoteControlControllers: number[] = [];

export enum RemoteConnectMinimumRole {
	FRIEND = 0,
	WHITELIST = 1,
	LOVER = 2,
	OWNER = 3
}

export function hasPermissionForRemoteControl(targetId: number): boolean {
	if (!modStorage.remoteControl.state) return false;
	if (modStorage.remoteControl.connectMinimumRole === RemoteConnectMinimumRole.WHITELIST) {
		return (
			Player.IsLoverOfMemberNumber(targetId) ||
			Player.IsOwnedByMemberNumber(targetId) ||
			Player.WhiteList.includes(targetId)
		);
	}
	if (modStorage.remoteControl.connectMinimumRole === RemoteConnectMinimumRole.LOVER) {
		return (
			Player.IsLoverOfMemberNumber(targetId) ||
			Player.IsOwnedByMemberNumber(targetId)
		);
	}
	if (modStorage.remoteControl.connectMinimumRole === RemoteConnectMinimumRole.OWNER) {
		return Player.IsOwnedByMemberNumber(targetId);
	}
	return Player.FriendList.includes(targetId);
}


export function loadRemoteControl(): void {
	messagesManager.onRequest("remoteControlConnect", (data, sender, senderName) => {
		const senderNumber = typeof sender === "number" ? sender : sender.MemberNumber!;
		if (!hasPermissionForRemoteControl(senderNumber)) {
			return {
				rejectReason: getText("remote.reject_min_role")
			};
		}
		if (!ServerPlayerIsInChatRoom()) {
			return {
				rejectReason: getText("remote.reject_not_in_room")
			};
		}
		if (!remoteControlControllers.includes(senderNumber)) {
			remoteControlControllers.push(senderNumber);
		}
		messagesManager.sendLocal(getText("remote.remote_connected", { name: senderName ?? "", num: senderNumber }));
		const pb = ServerPackItemPermissions(Player.PermissionItems);
		return {
			bundle: {
				ID: Player.CharacterID,
				Name: Player.Name,
				ActivePose: Player.ActivePose,
				ArousalSettings: Player.ArousalSettings,
				AssetFamily: Player.AssetFamily,
				BlackList: Player.BlackList,
				BlockItems: pb.BlockItems,
				Creation: Player.Creation,
				Description: Player.Description,
				Difficulty: Player.Difficulty,
				FavoriteItems: {},
				Game: {},
				Inventory: {},
				LimitedItems: pb.LimitedItems,
				ItemPermission: Player.AllowedInteractions,
				AllowedInteractions: Player.AllowedInteractions,
				Lovership: Player.Lovership,
				LabelColor: Player.LabelColor,
				MemberNumber: Player.MemberNumber,
				Nickname: Player.Nickname,
				OnlineSharedSettings: Player.OnlineSharedSettings,
				Owner: Player.Owner,
				Ownership: Player.Ownership,
				Reputation: Player.Reputation,
				Title: Player.Title,
				WhiteList: [],
				Appearance: ServerAppearanceBundle(Player.Appearance),
			} as ServerAccountDataSynced
		};
	});

	messagesManager.onRequest("remoteControlUpdate", (data, sender, senderName) => {
		const senderNumber = typeof sender === "number" ? sender : sender.MemberNumber!;
		if (
			!hasPermissionForRemoteControl(senderNumber) ||
			!remoteControlControllers.includes(senderNumber) ||
			!data.bundle
		) {
			return {
				wasChanged: false
			};
		}
		ServerAppearanceLoadFromBundle(
			Player,
			Player.AssetFamily,
			data.bundle,
			senderNumber
		);
		ChatRoomCharacterUpdate(Player);
		messagesManager.sendLocal(getText("remote.remote_changed", { name: senderName ?? "", num: senderNumber }));
		if (modStorage.remoteControl.notifyOthers ?? true) {
			sendLocalizedAction("remote.remote_action", { name: getNickname(Player) });
		}
		remoteControlControllers.splice(remoteControlControllers.indexOf(senderNumber), 1);
		return {
			wasChanged: true
		}
	});

	hookFunction("DialogMenuButtonBuild", HookPriority.ADD_BEHAVIOR, (args, next) => {
		next(args);
		if (remoteControlIsInteracting) {
			DialogMenuButton = DialogMenuButton.filter((btn) => btn !== "Activity");
		}
	});

	hookFunction("DialogLeave", HookPriority.ADD_BEHAVIOR, (args, next) => {
		if (remoteControlIsInteracting) {
			return DialogLeaveFocusItem();
		}
		return next(args);
	});

	hookFunction("DialogMenuBack", HookPriority.ADD_BEHAVIOR, async (args, next) => {
		const C = CurrentCharacter!;
		if (remoteControlIsInteracting) {
			const toastId = toastsManager.spinner({
				title: getText("remote.remote_updating"),
				message: getText("remote.remote_member_num", { num: C.MemberNumber ?? 0 })
			});
			const response = await messagesManager.sendRequest<{
				wasChanged: boolean
			}>({
				type: "beep",
				message: "remoteControlUpdate",
				data: {
					bundle: ServerAppearanceBundle(C.Appearance)
				},
				target: C.MemberNumber!
			});
			toastsManager.removeSpinner(toastId);
			setRemoteControlIsInteracting(false);
			DialogLeave();

			if (response.isError) {
				return toastsManager.error({
					message: getText("remote.remote_not_applied"),
					duration: 5000
				});
			}

			if (response.data?.wasChanged) {
				toastsManager.success({
					message: getText("remote.remote_applied"),
					duration: 5000
				});
			} else {
				toastsManager.error({
					message: getText("remote.remote_not_applied"),
					duration: 5000
				});
			}
			return;
		}
		return next(args);
	});

	hookFunction("DialogDraw", HookPriority.OBSERVE, (args, next) => {
		if (!CurrentCharacter?.Canvas?.getContext("2d") || !CurrentCharacter?.CanvasBlink?.getContext("2d")) return next(args);
		if (!remoteControlIsInteracting) return next(args);
		next(args);
		CurrentCharacter.Canvas.getContext("2d")!.globalAlpha = 1.0;
		CurrentCharacter.CanvasBlink.getContext("2d")!.globalAlpha = 1.0;
		CharacterAppearanceBuildCanvas(CurrentCharacter);
	});

	CommandCombine({
		Tag: "connect",
		Description: getText("remote.remote_desc"),
		Action: async (argumentsString: string, message: string, args: string[]) => {
			const targetNumber = parseInt(args[0]);
			if (!targetNumber) {
				return messagesManager.sendLocal(
					getText("remote.remote_example")
				);
			}

			const toastId = toastsManager.spinner({
				title: getText("remote.remote_connecting"),
				message: getText("remote.remote_member_num", { num: targetNumber })
			});

			const response = await messagesManager.sendRequest<{
				rejectReason?: string
				bundle?: ServerAccountDataSynced
			}>({
				type: "beep",
				message: "remoteControlConnect",
				target: targetNumber
			});

			toastsManager.removeSpinner(toastId);

			if (response.isError) {
				return toastsManager.error({
					title: getText("remote.remote_no_connection"),
					message: getText("remote.remote_error_generic"),
					duration: 6000
				});
			}

			if (response.data?.rejectReason) {
				return toastsManager.error({
					title: getText("remote.remote_rejected"),
					message: response.data.rejectReason,
					duration: 6000
				});
			}

			if (!response.data?.bundle) return;
			if (!ServerPlayerIsInChatRoom()) return;
			if (CurrentScreen !== "ChatRoom") CommonSetScreen("Online", "ChatRoom");
			const C = CharacterLoadOnline(response.data.bundle, targetNumber);
			setRemoteControlIsInteracting(true);
			ChatRoomFocusCharacter(C);
			if (!C.AllowItem) C.AllowItem = true;
			DialogChangeMode("items");
			DialogChangeFocusToGroup(C, "ItemArms");
		}
	})
}
