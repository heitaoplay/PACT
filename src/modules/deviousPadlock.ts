import { ModStorage, modStorage, SavedItem, syncStorage } from "./storage";
import { colorsEqual, getNickname, getPlayer, waitFor } from "zois-core";
import { hookFunction, HookPriority } from "zois-core/mod-sdk";
import { messagesManager } from "zois-core/messaging";
import { getCurrentSubscreen, setSubscreen } from "zois-core/ui";
import pactPadlockImage from "images/pact-lock-closed.png";
import { cloneDeep, isEqual } from "lodash-es";
import { DeviousPadlockSettingsSubscreen } from "subscreens/deviousPadlockSettingsSubscreen";
import { PadlockNotFoundSubscreen } from "subscreens/padlockNotFoundSubscreen";
import { sendLocalizedAction } from "src/modules/l10nMessage";
import { remoteControlIsInteracting } from "./remoteControl";
import { smartGetItemName } from "zois-core/wardrobe";
import { SyncPadlockMessageDto } from "dto/syncPadlockMessageDto";
import { UpdatePadlockMessageDto } from "dto/updatePadlockMessageDto";
import { CRAFTING_PARTIAL_KEYS, DEVIOUS_PADLOCK_COOLDOWN_TIME, DEVIOUS_PADLOCK_ITEM_PROPERTIES_TO_COMPARE, DEVIOUS_PADLOCK_MARKER, DEVIOUS_PADLOCK_MAX_TRIGGER_COUNT, DEVIOUS_PADLOCK_MINIMUM_FIRST_TRIGGER_INTERVAL, KNOWN_CHEAT_COMMANDS, COMPAT_PADLOCK_NAME, PACT_PADLOCK_NAME, isKnownPadlockName } from "src/constants";
import { logger } from "zois-core/logging";
import { t as getText } from "src/modules/i18n";
import { RemovePadlockMessageDto } from "src/dto/removePadlockMessageDto";

// 兼容锁：物品名保持狗锁的 DeviousPadlock，只是显示名/图标换成锁契的
export const deviousPadlock: AssetDefinition.Item = {
	Effect: [],
	Extended: true,
	IsLock: true,
	Name: COMPAT_PADLOCK_NAME,
	Time: 10,
	Value: 70,
	Wear: false,
	RemoveTime: 1000,
	DynamicDescription(C) { return getText("common.compat_padlock") },
};

// 锁契自有锁：全新物品，属于我们自己的锁体系
export const pactPadlock: AssetDefinition.Item = {
	Effect: [],
	Extended: true,
	IsLock: true,
	Name: PACT_PADLOCK_NAME,
	Time: 10,
	Value: 70,
	Wear: false,
	RemoveTime: 1000,
	DynamicDescription(C) { return getText("common.pact_padlock") },
};

export enum BasePadlock {
	EXCLUSIVE = "ExclusivePadlock",
	LOVERS = "LoversPadlock",
	OWNER = "OwnerPadlock",
};

export enum PutPadlockMinimumRole {
	PUBLIC = 3,
	FRIEND = 0,
	WHITELIST = 1,
	LOVER = 2,
	OWNER = 4
};

export enum KeyHolderMinimumRole {
	EVERYONE_EXCEPT_WEARER = 0,
	FRIEND = 4,
	WHITELIST = 5,
	FAMILY = 1,
	LOVER = 2,
	OWNER = 3
};

interface PadlockInspectionContext {
	target: Character
	itemGroup: AssetItemGroup
}

let pendingPadlockInspection: PadlockInspectionContext | null = null;

export interface DeviousPadlockUpdateData {
	baseLock?: DeviousPadlockSettings["baseLock"]
	minimumRole?: DeviousPadlockSettings["minimumRole"]
	memberNumbers?: DeviousPadlockSettings["memberNumbers"]
	note?: DeviousPadlockSettings["note"]
	preventCheatCommands?: DeviousPadlockSettings["preventCheatCommands"]
	unlockTime?: DeviousPadlockSettings["unlockTime"]
	combinationToLock?: {
		type: "PIN-Code" | "password"
		value: string
	}
	combinationToUnlock?: string
};

export interface DeviousPadlockSettings {
	item: SavedItem
	owner: number
	baseLock?: BasePadlock
	minimumRole?: KeyHolderMinimumRole
	memberNumbers?: number[]
	note?: string
	preventCheatCommands?: boolean
	unlockTime?: string
	combination?: {
		type: "PIN-Code" | "password"
		hash: string
	}
}

let deviousPadlockTriggerCooldown: {
	count: number,
	firstTriggerTime: number,
	expiresAt: number,
	state: boolean
} = {
	count: 0,
	firstTriggerTime: Date.now(),
	expiresAt: 0,
	state: false
};

function refreshDeviousPadlockCooldown(): void {
	if (deviousPadlockTriggerCooldown.state && Date.now() >= deviousPadlockTriggerCooldown.expiresAt) {
		deviousPadlockTriggerCooldown.state = false;
		deviousPadlockTriggerCooldown.count = 0;
		deviousPadlockTriggerCooldown.firstTriggerTime = Date.now();
		deviousPadlockTriggerCooldown.expiresAt = 0;
	}
}

let hasLoadedDeviousPadlock = false;
let lastPadlockAppearanceActionTime = 0;
const DEVIOUS_PADLOCK_APPEARANCE_SYNC_INTERVAL = 5000;
let lastPadlockAppearanceSyncTime = 0;
let pendingPadlockAppearanceSync: ReturnType<typeof setTimeout> | null = null;
let isCheckingDeviousPadlocks = false;
let internalPadlockUnlockDepth = 0;

function scheduleDeviousPadlockAppearanceSync(): void {
	if (!ServerPlayerIsInChatRoom() || pendingPadlockAppearanceSync) return;

	const delay = Math.max(
		0,
		DEVIOUS_PADLOCK_APPEARANCE_SYNC_INTERVAL - (Date.now() - lastPadlockAppearanceSyncTime)
	);
	pendingPadlockAppearanceSync = setTimeout(() => {
		pendingPadlockAppearanceSync = null;
		if (!ServerPlayerIsInChatRoom()) return;
		lastPadlockAppearanceSyncTime = Date.now();
		ChatRoomCharacterUpdate(Player);
	}, delay);
}

export function isDeviousLock(item: Item | null | undefined): boolean {
	return item?.Property?.IsDeviousLock === true ||
		(typeof item?.Property?.LockMessage === "string" && item.Property.LockMessage.startsWith(DEVIOUS_PADLOCK_MARKER));
}

function markDeviousPadlock(item: Item): boolean {
	item.Property ??= {};
	let changed = false;
	if (item.Property.IsDeviousLock !== true) {
		item.Property.IsDeviousLock = true;
		changed = true;
	}
	// R134 only transmits lock properties known to the base game. Keep a zero-width
	// marker in LockMessage so DOGS identity survives server validation and room sync.
	if (typeof item.Property.LockMessage !== "string" || !item.Property.LockMessage.startsWith(DEVIOUS_PADLOCK_MARKER)) {
		item.Property.LockMessage = DEVIOUS_PADLOCK_MARKER + (item.Property.LockMessage ?? "");
		changed = true;
	}
	return changed;
}

function unmarkDeviousPadlock(item: Item): void {
	if (item.Property?.IsDeviousLock === true) delete item.Property.IsDeviousLock;
	if (typeof item.Property?.LockMessage === "string" && item.Property.LockMessage.startsWith(DEVIOUS_PADLOCK_MARKER)) {
		const message = item.Property.LockMessage.slice(DEVIOUS_PADLOCK_MARKER.length);
		if (message) item.Property.LockMessage = message;
		else delete item.Property.LockMessage;
	}
}

function normalizePropsForCompare(props: ItemProperties | ItemPropertiesMinimized | undefined | null): Record<string, unknown> {
	if (!CommonIsObject(props)) return {};
	const result: Record<string, unknown> = {};
	for (const key of Object.keys(props)) {
		const value = (props as any)[key];
		if (value !== undefined) {
			result[key] = value;
		}
	}
	return result;
}

function restoreSavedProperties(item: Item, savedItem: SavedItem): void {
	// Restore the complete property set so R134 does not have to rebuild typed-item
	// fields from a partial snapshot during an unauthorized-unlock rollback.
	item.Property = ItemPropertiesDecompress(item, cloneDeep(savedItem.property), { C: Player });
	restoreSavedTypeRecord(item, savedItem);
}

function restoreSavedTypeRecord(item: Item, savedItem: SavedItem): void {
	// TypeRecord selects the actual typed-item state (for example, wrists bound).
	// Store it independently of minimized properties and restore it after the game
	// sanitizes the item so a rollback cannot silently fall back to the default mode.
	if (!Object.hasOwn(savedItem, "typeRecord")) return;
	item.Property ??= {};
	if (savedItem.typeRecord == null) {
		delete item.Property.TypeRecord;
	} else {
		item.Property.TypeRecord = cloneDeep(savedItem.typeRecord);
	}
}

function unlockItemInternally(target: Character, groupName: AssetGroupItemName): void {
	internalPadlockUnlockDepth++;
	try {
		InventoryUnlock(target, groupName);
	} finally {
		internalPadlockUnlockDepth--;
	}
}

function padlockAssetIsReady(): boolean {
	if (typeof AssetAdd !== "function") return false;
	if (typeof AssetGroupGet !== "function") return false;
	if (typeof AssetGet !== "function") return false;
	if (!Array.isArray(AssetFemale3DCG)) return false;
	if (!AssetFemale3DCGExtended) return false;
	if (!AssetFemale3DCG.some((group) => {
		const groupRecord = group as AssetGroupDefinition & { Name?: string };
		return groupRecord.Group === "ItemMisc" || groupRecord.Name === "ItemMisc";
	})) return false;
	return AssetGroupGet("Female3DCG", "ItemMisc") != null;
}

function getAssetGroupDefinition(groupName: AssetGroupName): AssetGroupDefinition | undefined {
	if (!Array.isArray(AssetFemale3DCG)) return undefined;
	const groupDefinition = AssetFemale3DCG.find((group) => {
		const groupRecord = group as AssetGroupDefinition & { Name?: string };
		return groupRecord.Group === groupName || groupRecord.Name === groupName;
	});
	return groupDefinition as AssetGroupDefinition | undefined;
}

function registerPadlockAssetWithCompatibility(asset: AssetDefinition.Item, group: AssetGroup, groupDefinition?: AssetGroupDefinition): void {
	const assetAddCompat = AssetAdd as unknown as (...args: unknown[]) => void;
	const attempts: Array<() => void> = [
		() => assetAddCompat(group, asset, AssetFemale3DCGExtended, groupDefinition),
		() => assetAddCompat(group, asset, groupDefinition, AssetFemale3DCGExtended),
		() => assetAddCompat(group, asset, AssetFemale3DCGExtended),
	];
	let lastError: unknown = undefined;

	for (const attempt of attempts) {
		try {
			attempt();
		} catch (error) {
			lastError = error;
		}
		if (AssetGet("Female3DCG", "ItemMisc", asset.Name)) return;
	}

	if (lastError instanceof Error) {
		throw lastError;
	}
	throw new Error(`Unable to register padlock asset ${asset.Name}`);
}


function createDeviousPadlock(): void {
	const itemMiscGroupDefinition = getAssetGroupDefinition("ItemMisc");
	const itemMiscGroup = AssetGroupGet("Female3DCG", "ItemMisc");
	if (!itemMiscGroup) {
		throw new Error("Unable to find ItemMisc asset group");
	}

	// 两把锁都注册：兼容锁（狗锁名）+ 锁契自有锁
	for (const asset of [deviousPadlock, pactPadlock]) {
		if (!AssetGet("Female3DCG", "ItemMisc", asset.Name)) {
			registerPadlockAssetWithCompatibility(asset, itemMiscGroup, itemMiscGroupDefinition);
		}
		// 物品栏按钮显示的是 Asset.Description；自定义资产默认回退成英文 Name。
		// 这里改成本地化中文名，只影响本机显示，不影响协议里的物品 Name。
		const registeredAsset = AssetGet("Female3DCG", "ItemMisc", asset.Name);
		if (registeredAsset) {
			(registeredAsset as { Description: string }).Description = getText(
				asset.Name === PACT_PADLOCK_NAME ? "common.pact_padlock" : "common.compat_padlock"
			);
		}
		InventoryAdd(Player, asset.Name, "ItemMisc");
	}
}

function getSavedItemData(item: Item): SavedItem {
	return cloneDeep({
		name: item.Asset.Name,
		color: item.Color,
		craft: item.Craft,
		property: ItemPropertiesCompress(item, { allowLocks: true }),
		typeRecord: item.Property?.TypeRecord ?? null
	});
}

export function registerDeviousPadlockInModStorage(group: AssetGroupItemName, ownerId: number): void {
	const currentItem = InventoryGet(Player, group);
	if (!currentItem) return;
	const lockDef: DeviousPadlockSettings = {
		item: getSavedItemData(currentItem),
		owner: ownerId,
	};
	const lockedBy = currentItem?.Property?.LockedBy;
	if (lockedBy && lockedBy !== BasePadlock.EXCLUSIVE && Object.values(BasePadlock).includes(lockedBy as BasePadlock)) {
		lockDef.baseLock = lockedBy as BasePadlock;
		lockDef.minimumRole = basePadlockMinimumRole(lockDef.baseLock);
	}
	markDeviousPadlock(currentItem);
	modStorage.deviousPadlock.itemGroups ??= {};
	modStorage.deviousPadlock.itemGroups[group] = lockDef;
}

function toPartialCraft(
	craft: CraftingItem | CraftingPartialItem | null | undefined
): CraftingPartialItem | undefined {
	if (!craft || typeof craft !== "object") return undefined;


	const partial = CommonPick(craft, [...CRAFTING_PARTIAL_KEYS]) as CraftingPartialItem;


	delete (partial as { Partial?: boolean }).Partial;


	partial.Name ??= "";
	partial.Description ??= "";
	partial.Effects ??= {};
	partial.Private ??= false;


	return partial;
}


function craftsEqual(
	a: CraftingItem | CraftingPartialItem | null | undefined,
	b: CraftingItem | CraftingPartialItem | null | undefined
): boolean {
	return isEqual(toPartialCraft(a), toPartialCraft(b));
}

export async function inspectDeviousPadlock(
	target: Character | null = CurrentCharacter,
	itemGroup: AssetItemGroup | null = target?.FocusGroup ?? null
): Promise<void> {
	if (!target || !itemGroup) return;
	pendingPadlockInspection = { target, itemGroup };
	DialogLeave();
	const screen = ["Character", "InspectDeviousPadlock"] as unknown as ScreenSpecifier;
	await CommonSetScreen(...screen);
}

function isFriend(a: Character, b: Character) {
	return a.IsPlayer() && a.HasOnFriendlist(b) || b.IsPlayer() && b.HasOnFriendlist(a);
}

function isInFamilyOfCharacter(a: Character, b: Character) {
	return a.IsInFamilyOfMemberNumber(b.MemberNumber ?? -1);
}

export function canUseBasePadlock(target1: Character, target2: Character, padlockOwner: number, baseLock: BasePadlock): boolean {
	if (target1.MemberNumber !== padlockOwner) return false;

	/*
			NOTE:
			We handle the special case of BlockLoverLockOwner on changePadlockConfigurations rather than here,
			both due to easier LogQuery handling and to ensure that we don't accidentally restrict owners from
			getting to the owner padlock (in the inspect subscreen) as a result of the intermediary lovers padlock
			being disabled for them, preventing back/next navigation.


			We also handle Block*LockSelf in changePadlockConfigurations as well, though solely for the aforementioned
			ease of handling.
		*/
	if (baseLock === BasePadlock.EXCLUSIVE) return true;
	if (baseLock === BasePadlock.LOVERS) return (
		(target1.MemberNumber === target2.MemberNumber && target2.Lovership.length > 0) ||
		target1.IsLoverOfCharacter(target2) || target2.IsOwnedByCharacter(target1)
	)
	if (baseLock === BasePadlock.OWNER) return (
		(target1.MemberNumber === target2.MemberNumber && target2.Ownership != null) ||
		target2.IsOwnedByCharacter(target1)
	)
	return false;
}

export function basePadlockMinimumRole(baseLock: BasePadlock, currentMinimumRole?: KeyHolderMinimumRole): KeyHolderMinimumRole {
	if (baseLock === BasePadlock.LOVERS) {
		if (currentMinimumRole === KeyHolderMinimumRole.OWNER) return currentMinimumRole;
		return KeyHolderMinimumRole.LOVER;
	}
	if (baseLock === BasePadlock.OWNER) return KeyHolderMinimumRole.OWNER;
	// Default (includes BasePadlock.EXCLUSIVE)
	return currentMinimumRole ?? KeyHolderMinimumRole.EVERYONE_EXCEPT_WEARER;
}

export function canPutDeviousPadlock(groupName: AssetGroupItemName, target1: Character, target2: Character): boolean {
	let storage: ModStorage;
	if (target2.IsPlayer()) storage = modStorage;
	else {
		if (!target2.DOGS) return false;
		storage = target2.DOGS;
	}
	if (!storage?.deviousPadlock?.state) return false;
	const minimumRole = storage?.deviousPadlock?.putMinimumRole ?? PutPadlockMinimumRole.PUBLIC;
	if (target1.MemberNumber === target2.MemberNumber) return true;
	if (minimumRole === PutPadlockMinimumRole.PUBLIC) return true;
	if (minimumRole === PutPadlockMinimumRole.FRIEND) return (
		isFriend(target1, target2) ||
		target2.HasOnWhitelist(target1) ||
		isInFamilyOfCharacter(target1, target2) || target1.IsLoverOfCharacter(target2) ||
		target2.IsOwnedByCharacter(target1)
	);
	if (minimumRole === PutPadlockMinimumRole.WHITELIST) return (
		target2.HasOnWhitelist(target1) ||
		isInFamilyOfCharacter(target1, target2) || target1.IsLoverOfCharacter(target2) ||
		target2.IsOwnedByCharacter(target1)
	);
	if (minimumRole === PutPadlockMinimumRole.LOVER) return (
		target1.IsLoverOfCharacter(target2) || target2.IsOwnedByCharacter(target1)
	);
	if (minimumRole === PutPadlockMinimumRole.OWNER) return target2.IsOwnedByCharacter(target1);
	return false;
}

export function hasKeyToPadlock(groupName: AssetGroupItemName, target1: Character, target2: Character): boolean {
	if (!target2.IsPlayer() && !target2.DOGS) return false;
	const settings = getPadlockSettings(target2, groupName);
	if (!settings) return false;
	const owner = settings.owner;
	const minimumRole = settings.minimumRole ?? KeyHolderMinimumRole.EVERYONE_EXCEPT_WEARER;
	const memberNumbers = settings.memberNumbers ?? [];
	if (target1.MemberNumber === owner || target1.MemberNumber !== undefined && memberNumbers.includes(target1.MemberNumber)) return true;
	if (minimumRole === KeyHolderMinimumRole.EVERYONE_EXCEPT_WEARER) return target1.MemberNumber !== target2.MemberNumber;
	if (minimumRole === KeyHolderMinimumRole.FRIEND) return (
		isFriend(target1, target2) ||
		target2.HasOnWhitelist(target1) ||
		isInFamilyOfCharacter(target1, target2) || target1.IsLoverOfCharacter(target2) ||
		target2.IsOwnedByCharacter(target1)
	);
	if (minimumRole === KeyHolderMinimumRole.WHITELIST) return (
		target2.HasOnWhitelist(target1) ||
		isInFamilyOfCharacter(target1, target2) || target1.IsLoverOfCharacter(target2) ||
		target2.IsOwnedByCharacter(target1)
	);
	if (minimumRole === KeyHolderMinimumRole.FAMILY) return (
		isInFamilyOfCharacter(target1, target2) || target1.IsLoverOfCharacter(target2) ||
		target2.IsOwnedByCharacter(target1)
	);
	if (minimumRole === KeyHolderMinimumRole.LOVER) return target1.IsLoverOfCharacter(target2) || target2.IsOwnedByCharacter(target1);
	if (minimumRole === KeyHolderMinimumRole.OWNER) return target2.IsOwnedByCharacter(target1);
	return false;
}

export function canSetKeyHolderMinimumRole(target1: Character, target2: Character, minimumRole: KeyHolderMinimumRole): boolean {
	if (target1.MemberNumber === target2.MemberNumber) return true;
	if (minimumRole === KeyHolderMinimumRole.EVERYONE_EXCEPT_WEARER) return true;
	if (minimumRole === KeyHolderMinimumRole.FRIEND) return (
		isFriend(target1, target2) ||
		target2.HasOnWhitelist(target1) ||
		isInFamilyOfCharacter(target1, target2) || target1.IsLoverOfCharacter(target2) ||
		target2.IsOwnedByCharacter(target1)
	);
	if (minimumRole === KeyHolderMinimumRole.WHITELIST) return (
		target2.HasOnWhitelist(target1) ||
		isInFamilyOfCharacter(target1, target2) || target1.IsLoverOfCharacter(target2) ||
		target2.IsOwnedByCharacter(target1)
	);
	if (minimumRole === KeyHolderMinimumRole.FAMILY) return (
		isInFamilyOfCharacter(target1, target2) || target1.IsLoverOfCharacter(target2) ||
		target2.IsOwnedByCharacter(target1)
	);
	if (minimumRole === KeyHolderMinimumRole.LOVER) return target1.IsLoverOfCharacter(target2) || target2.IsOwnedByCharacter(target1);
	if (minimumRole === KeyHolderMinimumRole.OWNER) return target2.IsOwnedByCharacter(target1);
	return false;
}

export function getPadlockSettings(target: Character, groupName: AssetGroupItemName): DeviousPadlockSettings | null {
	if (target.IsPlayer()) {
		modStorage.deviousPadlock.itemGroups ??= {};
		if (!modStorage.deviousPadlock.itemGroups[groupName]) return null;
		if (isItemGroupSynced(target, groupName)) {
			return {
				...getSyncConfigOfItemGroup(target, groupName),
				item: modStorage.deviousPadlock.itemGroups[groupName].item,
				owner: modStorage.deviousPadlock.itemGroups[groupName].owner
			}
		}
		return modStorage.deviousPadlock.itemGroups[groupName];
	}
	if (!target.DOGS?.deviousPadlock?.itemGroups?.[groupName]) return null;
	if (isItemGroupSynced(target, groupName)) {
		return {
			...getSyncConfigOfItemGroup(target, groupName),
			item: target.DOGS.deviousPadlock.itemGroups[groupName].item,
			owner: target.DOGS.deviousPadlock.itemGroups[groupName].owner
		}
	}
	return target.DOGS.deviousPadlock.itemGroups[groupName];
}

export function getPadlocksAmount(target: Character) {
	return target.Appearance.reduce((count, item) => {
		if (isDeviousLock(item)) return count + 1;
		return count;
	}, 0);
}

export async function validatePadlockSettingsUpdate(from: Character, settings: DeviousPadlockUpdateData, padlockGroupName: AssetGroupItemName): Promise<{
	valid: true
	data: DeviousPadlockUpdateData
} | {
	valid: false
}> {
	if (!modStorage.deviousPadlock?.itemGroups?.[padlockGroupName]) return { valid: false };
	if (typeof modStorage.deviousPadlock.itemGroups[padlockGroupName].combination?.hash === "string" && typeof settings.combinationToUnlock === "string") {
		if (
			!hasKeyToPadlock(padlockGroupName, from, Player) &&
			(
				await hashCombination(settings.combinationToUnlock) !==
				modStorage.deviousPadlock.itemGroups[padlockGroupName].combination?.hash
			)
		) return { valid: false };
	} else {
		if (!hasKeyToPadlock(padlockGroupName, from, Player)) return { valid: false };
	}
	const data: DeviousPadlockUpdateData = {};
	if (settings.combinationToLock !== undefined) {
		if (
			(
				settings.combinationToLock.type === "PIN-Code" &&
				settings.combinationToLock.value.length === 6 &&
				Number.isInteger(parseInt(settings.combinationToLock.value))
			) ||
			(
				settings.combinationToLock.type === "password" &&
				settings.combinationToLock.value.trim() !== "" &&
				settings.combinationToLock.value.length <= 25
			)
		) {
			data.combinationToLock = settings.combinationToLock;
		}
	}
	if (settings.minimumRole !== undefined && canSetKeyHolderMinimumRole(from, Player, settings.minimumRole)) {
		data.minimumRole = settings.minimumRole;
	}
	if (settings.memberNumbers !== undefined) {
		data.memberNumbers = settings.memberNumbers;
	}
	if (settings.unlockTime !== undefined) {
		data.unlockTime = settings.unlockTime.trim();
	}
	if (settings.baseLock !== undefined && canUseBasePadlock(from, Player, modStorage.deviousPadlock.itemGroups[padlockGroupName].owner, settings.baseLock)) {
		if (
			!(settings.baseLock === BasePadlock.LOVERS && Player.IsOwnedByCharacter(from) && LogQuery("BlockLoverLockOwner", "LoverRule")) &&
			!(Player.MemberNumber === from.MemberNumber && (
				(settings.baseLock === BasePadlock.OWNER && LogQuery("BlockOwnerLockSelf", "OwnerRule")) ||
				(settings.baseLock === BasePadlock.LOVERS && LogQuery("BlockLoverLockSelf", "LoverRule"))
			))
		) data.baseLock = settings.baseLock;
	}
	if (settings.note !== undefined) {
		data.note = settings.note;
	}
	if (settings.preventCheatCommands !== undefined) {
		data.preventCheatCommands = settings.preventCheatCommands;
	}
	const currentPadlockSettings = getPadlockSettings(Player, padlockGroupName);
	const baseLock = data.baseLock ?? currentPadlockSettings?.baseLock ?? BasePadlock.EXCLUSIVE;
	if (data.baseLock !== undefined || data.minimumRole !== undefined) {
		data.minimumRole = basePadlockMinimumRole(baseLock, data.minimumRole ?? currentPadlockSettings?.minimumRole);
	}
	if (baseLock !== BasePadlock.EXCLUSIVE && (data.baseLock !== undefined || settings.memberNumbers !== undefined)) {
		data.memberNumbers = [];
	}
	return { valid: true, data };
}

export async function changePadlockSettings(
	groupName: AssetGroupItemName,
	config: DeviousPadlockUpdateData
): Promise<void> {
	if (!modStorage.deviousPadlock.itemGroups?.[groupName]) return;
	if (config.unlockTime !== undefined) {
		if (config.unlockTime === "") delete modStorage.deviousPadlock.itemGroups[groupName].unlockTime;
		else modStorage.deviousPadlock.itemGroups[groupName].unlockTime = config.unlockTime;
	}
	if (config.combinationToLock !== undefined) {
		if (config?.combinationToLock?.value.trim() === "") {
			delete modStorage.deviousPadlock.itemGroups[groupName].combination;
		} else {
			modStorage.deviousPadlock.itemGroups[groupName].combination = {
				type: config.combinationToLock.type,
				hash: await hashCombination(config.combinationToLock.value)
			};
		}
	}
	if (config.baseLock !== undefined) {
		const item = InventoryGet(Player, groupName);
		modStorage.deviousPadlock.itemGroups[groupName].baseLock = config.baseLock;
		if (item) {
			markDeviousPadlock(item);
			const previousLockedBy = item.Property.LockedBy;
			const previousLockMemberNumber = item.Property.LockMemberNumber;
			item.Property.LockedBy = config.baseLock;
			item.Property.LockMemberNumber = modStorage.deviousPadlock.itemGroups[groupName].owner;
			const changed = ValidationSanitizeLock(Player, item);
			if (changed) {
				logger.warn("Sanitized lock properties when changing BaseLock");
			}
			markDeviousPadlock(item);
			modStorage.deviousPadlock.itemGroups[groupName].item = getSavedItemData(item);
			if (previousLockedBy !== item.Property.LockedBy || previousLockMemberNumber !== item.Property.LockMemberNumber) {
				ChatRoomCharacterUpdate(Player);
			}
		}
	}
	if (config.note !== undefined) {
		modStorage.deviousPadlock.itemGroups[groupName].note = config.note;
	}
	if (config.preventCheatCommands !== undefined) {
		modStorage.deviousPadlock.itemGroups[groupName].preventCheatCommands = config.preventCheatCommands;
	}
	if (config.memberNumbers !== undefined) modStorage.deviousPadlock.itemGroups[groupName].memberNumbers = config.memberNumbers;
	if (config.minimumRole !== undefined) modStorage.deviousPadlock.itemGroups[groupName].minimumRole = config.minimumRole;
	unsyncItemGroups([groupName], false);
	syncStorage();
}

function onAppearanceChange(source: Character, target: Character): void {
	if (target.IsPlayer()) checkDeviousPadlocks(source);
}

function checkDeviousPadlocks(sourceCharacter: Character): void {
	if (isCheckingDeviousPadlocks) return;
	isCheckingDeviousPadlocks = true;
	try {
		checkDeviousPadlocksCore(sourceCharacter);
	} finally {
		isCheckingDeviousPadlocks = false;
	}
}

function checkDeviousPadlocksCore(sourceCharacter: Character): void {
	// Check the deadline here as well as in the timeout. This recovers cleanly if
	// the tab was background-throttled while the player disconnected/reconnected.
	refreshDeviousPadlockCooldown();
	let appearanceChanged = false;
	let sync = false;
	let restoredPadlockAppearance = false;

	if (modStorage.deviousPadlock.itemGroups) {
		let padlocksChangedItemNames: string[] = [];

		for (const group in modStorage.deviousPadlock.itemGroups ?? {}) {
			const groupName = group as AssetGroupItemName;
			const currentItem = InventoryGet(Player, groupName);
			const padlockSettings = getPadlockSettings(Player, groupName);
			if (!padlockSettings) continue;

			const savedItem = padlockSettings.item;
			const owner = padlockSettings.owner;
			const basePadlock = padlockSettings.baseLock ?? BasePadlock.EXCLUSIVE;

			if (currentItem && currentItem.Property?.LockedBy === basePadlock) {
				if (markDeviousPadlock(currentItem)) {
					appearanceChanged = true;
					sync = true;
				}
			}

			const propertyMinimized = currentItem !== null ? ItemPropertiesCompress(currentItem) : {};
			const padlockSame = isDeviousLock(currentItem) && currentItem?.Property?.LockedBy === basePadlock;

			const getValidProperties = (properties: ItemPropertiesMinimized | undefined) => {
				if (!CommonIsObject(properties)) return properties;
				const validProperties: ItemPropertiesMinimized = {};
				DEVIOUS_PADLOCK_ITEM_PROPERTIES_TO_COMPARE.forEach((p) => {
					if (Object.hasOwn(properties, p)) (validProperties as Record<any, any>)[p] = properties[p];
				});
				return validProperties;
			};

			const nameSame = currentItem?.Asset?.Name === savedItem.name;
			const colorSame = colorsEqual(currentItem?.Color, savedItem.color);
			const craftSame = craftsEqual(currentItem?.Craft, savedItem.craft);
			const currentValidProps = getValidProperties(propertyMinimized);
			const savedValidProps = getValidProperties(savedItem.property);
			const typeRecordChanged = nameSame && currentItem !== null &&
				!isEqual(currentValidProps?.TypeRecord, savedValidProps?.TypeRecord);
			const propsSame = isEqual(
				normalizePropsForCompare(currentValidProps),
				normalizePropsForCompare(savedValidProps)
			);

			if (
				!nameSame ||
				!colorSame ||
				!craftSame ||
				!propsSame ||
				!padlockSame
			) {
				if (nameSame && currentItem && (padlockSame || typeRecordChanged)) {
					// Typed-item mode changes can rebuild the item's Property object and
					// temporarily drop the lock fields. Preserve the new TypeRecord, but
					// restore the DOGS lock before accepting that state as the new snapshot.
					let lockPropertiesChanged = false;
					currentItem.Property ??= {};
					if (currentItem.Property.LockedBy !== basePadlock) {
						currentItem.Property.LockedBy = basePadlock;
						lockPropertiesChanged = true;
					}
					if (currentItem.Property.LockMemberNumber !== owner) {
						currentItem.Property.LockMemberNumber = owner;
						lockPropertiesChanged = true;
					}
					if (!currentItem.Property.Effect?.includes("Lock")) {
						currentItem.Property.Effect ??= [];
						currentItem.Property.Effect.push("Lock");
						lockPropertiesChanged = true;
					}
					if (markDeviousPadlock(currentItem)) lockPropertiesChanged = true;
					if (lockPropertiesChanged) {
						ValidationSanitizeLock(Player, currentItem);
						currentItem.Property ??= {};
						markDeviousPadlock(currentItem);
						currentItem.Property.LockedBy = basePadlock;
						currentItem.Property.LockMemberNumber = owner;
						currentItem.Property.Effect ??= [];
						if (!currentItem.Property.Effect.includes("Lock")) currentItem.Property.Effect.push("Lock");
						currentItem.Property.Effect = [...new Set(currentItem.Property.Effect ?? [])];
						appearanceChanged = true;
						if (!padlockSame) restoredPadlockAppearance = true;
					}
					const updatedSavedItem = getSavedItemData(currentItem);
					if (!isEqual(savedItem, updatedSavedItem)) {
						modStorage.deviousPadlock.itemGroups[groupName]!.item = updatedSavedItem;
						sync = true;
					}
				} else if (hasKeyToPadlock(groupName, sourceCharacter, Player)) {
					if (!padlockSame) {
						delete modStorage.deviousPadlock.itemGroups[groupName];
						unsyncItemGroups([groupName], false);
						sync = true;
					} else {
						const updatedSavedItem = getSavedItemData(currentItem!);
						if (!isEqual(savedItem, updatedSavedItem)) {
							modStorage.deviousPadlock.itemGroups[groupName]!.item = updatedSavedItem;
							sync = true;
						}
					}
				} else if (deviousPadlockTriggerCooldown.state) {
					// 循环刹车已触发：暂停重建，让重复恢复停下来，避免刷屏/掉线（issue #24/#25）。
					// 权限校验分支仍照常运行，有钥匙的人依旧能解除登记。
					continue;
				} else {
					const savedAsset = AssetGet(Player.AssetFamily, groupName, savedItem.name);
					if (!savedAsset) {
						logger.warn("Invalid asset: " + savedItem.name);
						continue;
					}

					const beforeRestoreData = currentItem ? getSavedItemData(currentItem) : null;
					let newItem: Item | null = null;

					if (nameSame && currentItem) {
						if (savedItem.color) currentItem.Color = savedItem.color;
						if (savedItem.craft) {
							currentItem.Craft = cloneDeep(savedItem.craft);
						} else {
							delete currentItem.Craft;
						}

						currentItem.Property ??= {};

						restoreSavedProperties(currentItem, savedItem);

						markDeviousPadlock(currentItem);
						currentItem.Property.LockedBy = basePadlock;
						currentItem.Property.LockMemberNumber = owner;
						currentItem.Property.Effect ??= [];
						if (!currentItem.Property.Effect.includes("Lock")) {
							currentItem.Property.Effect.push("Lock");
						}
						currentItem.Property.Effect = [...new Set(currentItem.Property.Effect)];

						ValidationSanitizeProperties(Player, currentItem);
						ValidationSanitizeLock(Player, currentItem);
						restoreSavedTypeRecord(currentItem, savedItem);

						markDeviousPadlock(currentItem);
						currentItem.Property.LockedBy = basePadlock;
						currentItem.Property.LockMemberNumber = owner;
						currentItem.Property.Effect ??= [];
						if (!currentItem.Property.Effect.includes("Lock")) {
							currentItem.Property.Effect.push("Lock");
						}
						currentItem.Property.Effect = [...new Set(currentItem.Property.Effect)];

						newItem = currentItem;
					} else {
						const difficulty = savedAsset.Difficulty;
						newItem = InventoryWear(Player, savedItem.name, groupName, savedItem.color, difficulty, Player.MemberNumber, savedItem.craft, false);
						if (!newItem) continue;

						newItem.Property ??= {};
						restoreSavedProperties(newItem, savedItem);
						newItem.Property.Effect ??= [];
						if (!newItem.Property.Effect.includes("Lock")) newItem.Property.Effect.push("Lock");
						newItem.Property.Effect = [...new Set(newItem.Property.Effect)];
						markDeviousPadlock(newItem);
						if (newItem.Property.LockedBy !== basePadlock) newItem.Property.LockedBy = basePadlock;
						if (newItem.Property.LockMemberNumber !== owner) newItem.Property.LockMemberNumber = owner;

						ValidationSanitizeProperties(Player, newItem);
						ValidationSanitizeLock(Player, newItem);
						restoreSavedTypeRecord(newItem, savedItem);

						markDeviousPadlock(newItem);
						newItem.Property.LockedBy = basePadlock;
						newItem.Property.LockMemberNumber = owner;
						newItem.Property.Effect ??= [];
						if (!newItem.Property.Effect.includes("Lock")) newItem.Property.Effect.push("Lock");
						newItem.Property.Effect = [...new Set(newItem.Property.Effect)];
					}

					const afterSaveData = getSavedItemData(newItem);
					if (!isEqual(savedItem, afterSaveData)) {
						modStorage.deviousPadlock.itemGroups[groupName]!.item = afterSaveData;
						sync = true;
					}
					if (!padlockSame) {
						padlocksChangedItemNames.push(newItem.Craft?.Name ? newItem.Craft.Name : newItem.Asset.Description);
					}

					if (!beforeRestoreData || !isEqual(beforeRestoreData, afterSaveData)) {
						appearanceChanged = true;
						restoredPadlockAppearance = true;
					}
				}
			}
		}

		if (
			ServerPlayerIsInChatRoom() &&
			!deviousPadlockTriggerCooldown.state &&
			padlocksChangedItemNames.length > 0 &&
			Date.now() - lastPadlockAppearanceActionTime >= 3000
		) {
			lastPadlockAppearanceActionTime = Date.now();
			if (padlocksChangedItemNames.length === 1) {
				sendLocalizedAction("actions.action_reappear_one", { name: getNickname(Player), item: padlocksChangedItemNames[0] });
			}
			if (padlocksChangedItemNames.length > 1) {
				sendLocalizedAction("actions.action_reappear_many", { name: getNickname(Player), items: padlocksChangedItemNames.join(", ") });
			}
		}

		if (ServerPlayerIsInChatRoom() && restoredPadlockAppearance && !deviousPadlockTriggerCooldown.state) {
			if (deviousPadlockTriggerCooldown.count === 0) {
				deviousPadlockTriggerCooldown.firstTriggerTime = Date.now();
			}
			deviousPadlockTriggerCooldown.count++;
			if (deviousPadlockTriggerCooldown.count > DEVIOUS_PADLOCK_MAX_TRIGGER_COUNT) {
				deviousPadlockTriggerCooldown.count = 0;
				if ((Date.now() - deviousPadlockTriggerCooldown.firstTriggerTime) < DEVIOUS_PADLOCK_MINIMUM_FIRST_TRIGGER_INTERVAL) {
					deviousPadlockTriggerCooldown.state = true;
					deviousPadlockTriggerCooldown.expiresAt = Date.now() + DEVIOUS_PADLOCK_COOLDOWN_TIME;
					sendLocalizedAction("actions.action_cooldown", { minutes: DEVIOUS_PADLOCK_COOLDOWN_TIME / (1000 * 60) });
					setTimeout(() => {
						const wasCoolingDown = deviousPadlockTriggerCooldown.state;
						refreshDeviousPadlockCooldown();
						if (wasCoolingDown && !deviousPadlockTriggerCooldown.state) checkDeviousPadlocks(Player);
					}, DEVIOUS_PADLOCK_COOLDOWN_TIME);
				}
			}
		}
	}

	Player.Appearance.forEach((item) => {
		if (
			isDeviousLock(item) &&
			Object.values(BasePadlock).includes(item.Property?.LockedBy as BasePadlock)
		) {
			if (
				!modStorage.deviousPadlock.itemGroups ||
				!modStorage.deviousPadlock.itemGroups[item.Asset.Group.Name as AssetGroupItemName]
			) {
				if (!canPutDeviousPadlock(item.Asset.Group.Name as AssetGroupItemName, sourceCharacter, Player)) {
					unlockItemInternally(Player, item.Asset.Group.Name as AssetGroupItemName);
					appearanceChanged = true;
				} else {
					registerDeviousPadlockInModStorage(item.Asset.Group.Name as AssetGroupItemName, sourceCharacter.MemberNumber!);
					sync = true;
				}
			}
		}
	});

	if (sync) {
		syncStorage();
	}

	if (appearanceChanged) {
		CharacterRefresh(Player, true);
		// Use the full native appearance path so every client rebuilds layer order,
		// masks, and canvas from the same complete appearance state.
		scheduleDeviousPadlockAppearanceSync();
		if (restoredPadlockAppearance) {
			requestAnimationFrame(() => CharacterRefresh(Player, false, false));
		}
	}
}

function checkDeviousPadlocksTimers(): void {
	refreshDeviousPadlockCooldown();
	if (!modStorage.deviousPadlock.itemGroups || deviousPadlockTriggerCooldown.state) return;
	let didUnlock = false;
	for (const _groupName in modStorage.deviousPadlock.itemGroups ?? {}) {
		const groupName = _groupName as AssetGroupItemName;
		const unlockTime = getPadlockSettings(Player, groupName)?.unlockTime;
		const item = InventoryGet(Player, groupName);
		if (!item) continue;
		if (unlockTime && new Date(unlockTime) < new Date()) {
			const itemName = smartGetItemName(item);
			sendLocalizedAction("actions.action_timer_open", { name: getNickname(Player), item: itemName });
			delete modStorage.deviousPadlock.itemGroups[groupName];
			unsyncItemGroups([groupName], false);
			syncStorage();
			unlockItemInternally(Player, groupName);
			didUnlock = true;
		}
	}
	// Only do that once instead of spamming it for each group
	if (didUnlock) {
		ChatRoomCharacterUpdate(Player);
	}
}

export async function hashCombination(combination: string): Promise<string> {
	const data = new TextEncoder().encode(combination);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
	return hashHex;
}

function applyEffectiveBaseLockToPadlock(groupName: AssetGroupItemName): boolean {
	const item = InventoryGet(Player, groupName);
	if (!item) return false;
	const isLegacyPadlockState = Object.values(BasePadlock).includes(item.Property?.LockedBy as BasePadlock);
	if (!isDeviousLock(item) && !isLegacyPadlockState) return false;
	const padlockSettings = getPadlockSettings(Player, groupName);
	if (!padlockSettings) return false;
	item.Property ??= {};
	markDeviousPadlock(item);
	const baseLock = padlockSettings.baseLock ?? BasePadlock.EXCLUSIVE;
	let changed = false;
	if (item.Property.LockedBy !== baseLock) {
		item.Property.LockedBy = baseLock;
		changed = true;
	}
	if (item.Property.LockMemberNumber !== padlockSettings.owner) {
		item.Property.LockMemberNumber = padlockSettings.owner;
		changed = true;
	}
	if (changed) {
		const sanitized = ValidationSanitizeLock(Player, item);
		if (sanitized) {
			logger.warn("Sanitized lock properties when syncing BaseLock");
		}
		markDeviousPadlock(item);
		modStorage.deviousPadlock.itemGroups![groupName]!.item = getSavedItemData(item);
	}
	return changed;
}


export function syncPadlockConfigurationWithItemGroups(groupNames: AssetGroupItemName[], config: Omit<DeviousPadlockSettings, "item" | "owner">, push = true) {
	const uniqueGroupNames = [...new Set(groupNames)];
	unsyncItemGroups(uniqueGroupNames, false);
	modStorage.deviousPadlock.synced ??= [];
	const sameConfig = modStorage.deviousPadlock.synced.find(({ groupNames, ...rest }) => isEqual(rest, config));
	if (sameConfig) {
		sameConfig.groupNames = [...new Set([...sameConfig.groupNames, ...uniqueGroupNames])];
	} else {
		modStorage.deviousPadlock.synced.push({
			...config,
			groupNames: uniqueGroupNames
		});
	}
	let shouldPushChatRoomUpdate = false;
	for (const groupName of uniqueGroupNames) {
		if (applyEffectiveBaseLockToPadlock(groupName)) {
			shouldPushChatRoomUpdate = true;
		}
	}
	if (shouldPushChatRoomUpdate && ServerPlayerIsInChatRoom()) {
		ChatRoomCharacterUpdate(Player);
	}
	if (push) syncStorage();
}

export function unsyncItemGroups(groupNames: AssetGroupItemName[], push = true) {
	if (!modStorage.deviousPadlock.synced) return;
	modStorage.deviousPadlock.synced = modStorage.deviousPadlock.synced.map((config) => {
		config.groupNames ??= [];
		config.groupNames = config.groupNames.filter((g) => !groupNames.includes(g));
		return config;
	}).filter((config) => config.groupNames.length > 0);
	if (push) syncStorage();
}

export function isItemGroupSynced(target: Character, groupName: AssetGroupItemName): boolean {
	if (target.IsPlayer()) {
		if (!modStorage.deviousPadlock.synced) return false;
		return modStorage.deviousPadlock.synced.some((config) => config.groupNames?.includes(groupName));
	}
	if (!target.DOGS?.deviousPadlock?.synced) return false;
	return target.DOGS.deviousPadlock.synced.some((config) => config.groupNames?.includes(groupName));
}

export function getSyncConfigOfItemGroup(target: Character, groupName: AssetGroupItemName): Omit<DeviousPadlockSettings, "item" | "owner"> | null {
	if (target.IsPlayer()) {
		if (!modStorage.deviousPadlock.synced) return null;
		const config = modStorage.deviousPadlock.synced.find((c) => c.groupNames.includes(groupName));
		if (!config) return null;
		const { groupNames, ...syncConfig } = config;
		return syncConfig;
	}
	if (!target.DOGS?.deviousPadlock?.synced) return null;
	const config = target.DOGS.deviousPadlock.synced.find((c) => c.groupNames.includes(groupName));
	if (!config) return null;
	const { groupNames, ...syncConfig } = config;
	return syncConfig;
}

export function isItemGroupSyncedWithConfig(
	target: Character,
	groupName: AssetGroupItemName,
	config: Omit<DeviousPadlockSettings, "item" | "owner">
): boolean {
	if (target.IsPlayer()) {
		if (!modStorage.deviousPadlock.synced) return false;
		return modStorage.deviousPadlock.synced.some((c) => {
			const { groupNames, ..._c } = c;
			return groupNames?.includes(groupName) && isEqual(_c, config);
		});
	}
	if (!target.DOGS?.deviousPadlock?.synced) return false;
	return target.DOGS.deviousPadlock.synced.some((c) => {
		const { groupNames, ..._c } = c;
		return groupNames?.includes(groupName) && isEqual(_c, config);
	});
}

export async function loadDeviousPadlock(): Promise<void> {
	if (hasLoadedDeviousPadlock) return;
	try {
		await waitFor(padlockAssetIsReady);
	} catch {
		logger.error("DeviousPadlock boot timed out: ItemMisc asset group is not ready");
		return;
	}

	createDeviousPadlock();
	hasLoadedDeviousPadlock = true;
	let needsSync = false;
	let shouldPushChatRoomUpdate = false;
	Object.keys(modStorage.deviousPadlock.itemGroups ?? {}).forEach((g) => {
		const groupName = g as AssetGroupItemName;
		const itemGroup = modStorage.deviousPadlock.itemGroups![groupName]!;
		const padlockSettings = getPadlockSettings(Player, groupName);
		if (!padlockSettings) return;
		const baseLock = padlockSettings.baseLock;
		if (
			baseLock === BasePadlock.LOVERS &&
			Player.Lovership.length === 0
		) {
			delete modStorage.deviousPadlock.itemGroups![groupName];
			unsyncItemGroups([groupName], false);
			syncStorage();
			return;
		}
		if (
			baseLock === BasePadlock.OWNER &&
			Player.IsOwned() === false
		) {
			delete modStorage.deviousPadlock.itemGroups![groupName];
			unsyncItemGroups([groupName], false);
			needsSync = true;
			return;
		}
		const appearanceItem = ServerBundledItemToAppearanceItem(Player.AssetFamily, {
			Name: itemGroup.item.name,
			Color: itemGroup.item.color,
			Craft: itemGroup.item.craft,
			Property: itemGroup.item.property,
			Group: groupName
		});
		if (!appearanceItem) {
			delete modStorage.deviousPadlock.itemGroups![groupName];
			unsyncItemGroups([groupName], false);
			needsSync = true;
			return;
		};
		const changed = ValidationSanitizeProperties(Player, appearanceItem);
		if (changed) {
			modStorage.deviousPadlock.itemGroups![groupName]!.item = getSavedItemData(appearanceItem);
			needsSync = true;
		}
		if (applyEffectiveBaseLockToPadlock(groupName)) {
			needsSync = true;
			shouldPushChatRoomUpdate = true;
		}
	});
	if (shouldPushChatRoomUpdate && ServerPlayerIsInChatRoom()) {
		ChatRoomCharacterUpdate(Player);
	}
	if (needsSync) {
		syncStorage();
	}
	checkDeviousPadlocks(Player);
	setInterval(checkDeviousPadlocksTimers, 1000);
	hookFunction("ChatRoomSync", HookPriority.OBSERVE, (args, next) => {
		const result = next(args);
		// Recheck after the complete room snapshot loads so a reconnect cannot leave
		// an unauthorized unlock in place until the next manual refresh.
		void Promise.resolve(result).then(() => {
			if (ServerPlayerIsInChatRoom()) checkDeviousPadlocks(Player);
		}).catch((error) => logger.warn("Devious padlock room sync check failed:", error));
		return result;
	});

	window.InspectDeviousPadlockBackground = "Sheet";
	window.InspectDeviousPadlockLoad = async () => {
		const inspection = pendingPadlockInspection;
		pendingPadlockInspection = null;
		const target = inspection?.target ?? CurrentCharacter;
		const itemGroup = inspection?.itemGroup ?? target?.FocusGroup;
		if (!target || !itemGroup) return;
		if (!getPadlockSettings(target, itemGroup.Name)) {
			const item = InventoryGet(target, itemGroup.Name);
			if (item && target.IsPlayer() && isDeviousLock(item)) {
				registerDeviousPadlockInModStorage(itemGroup.Name, Number(item.Property.LockMemberNumber ?? Player.MemberNumber));
			}
		}
		if (!getPadlockSettings(target, itemGroup.Name)) {
			logger.warn(`Cannot inspect Devious Padlock on ${itemGroup.Name}: lock settings have not synced for this character`);
			// 不再留白屏：显示中文提示界面，BaseSubscreen 自带退出按钮，ESC 也能退出
			setSubscreen(new PadlockNotFoundSubscreen(itemGroup.Name));
			return;
		}
		setSubscreen(
			new DeviousPadlockSettingsSubscreen({
				mode: "inspect-padlock",
				itemGroup,
				target
			})
		);
	};
	window.InspectDeviousPadlockRun = () => {
		getCurrentSubscreen()?.run?.();
	};
	window.InspectDeviousPadlockClick = () => {
		getCurrentSubscreen()?.click?.();
	};
	window.InspectDeviousPadlockResize = () => {
		getCurrentSubscreen()?.resize?.();
	};

	ServerPlayerChatRoom.register({
		screen: "InspectDeviousPadlock" as ScreenName,
		callback: () => getCurrentSubscreen() instanceof DeviousPadlockSettingsSubscreen ||
			getCurrentSubscreen() instanceof PadlockNotFoundSubscreen
	});

	messagesManager.onPacket("changePadlockSettings", UpdatePadlockMessageDto, async (data: UpdatePadlockMessageDto, sender) => {
		const result = await validatePadlockSettingsUpdate(sender, data.config, data.groupName);
		if (!result.valid) {
			logger.warn("Ignored invalid padlock update packet:", data);
			return;
		}
		changePadlockSettings(data.groupName, result.data);
		const itemName = smartGetItemName(InventoryGet(Player, data.groupName)!);
		sendLocalizedAction("actions.action_config_changed", { sender: getNickname(sender), name: getNickname(Player), item: itemName });
	});

	messagesManager.onPacket(
		"syncPadlockConfigurations",
		SyncPadlockMessageDto,
		async (data: SyncPadlockMessageDto, sender) => {
			for (const groupName of data.groupNames) {
				const result = await validatePadlockSettingsUpdate(sender, data.settings, groupName);
				if (!result.valid) data.groupNames.splice(data.groupNames.indexOf(groupName), 1);
			}
			syncPadlockConfigurationWithItemGroups(data.groupNames, data.settings);
		}
	);

	messagesManager.onPacket("removePadlock", RemovePadlockMessageDto, async (data: RemovePadlockMessageDto, sender) => {
		const itemGroups = (modStorage.deviousPadlock.itemGroups ??= {});
		const groupName = data.groupName;
		const item = InventoryGet(Player, groupName);
		if (!item) return;

		if (!!itemGroups[groupName]) {
			if (
				await hashCombination(data.combination) ===
				itemGroups[groupName].combination?.hash
			) {
				const itemName = smartGetItemName(item);
				delete modStorage.deviousPadlock.itemGroups[data.groupName];
				unsyncItemGroups([data.groupName], false);
				unlockItemInternally(Player, data.groupName);
				ChatRoomCharacterUpdate(Player);
				syncStorage();
				sendLocalizedAction("actions.action_unlocked_by_code", { sender: getNickname(sender), name: getNickname(Player), item: itemName });
			}
		}
	});

	Object.values(BasePadlock).forEach((baseLock) => {
		if (baseLock === BasePadlock.LOVERS) return;
		hookFunction(`InventoryItemMisc${baseLock}DrawHook`, HookPriority.ADD_BEHAVIOR, (args, next) => {
			if (!CurrentCharacter || !CurrentCharacter.FocusGroup) return next(args);
			const item = InventoryGet(CurrentCharacter, CurrentCharacter.FocusGroup.Name);
			if (item && isDeviousLock(item)) {
				void inspectDeviousPadlock(CurrentCharacter, CurrentCharacter.FocusGroup);
				return;
			}
			return next(args);
		});
	});

	hookFunction("DialogCanUnlock", HookPriority.ADD_BEHAVIOR, (args, next) => {
		const [target, item] = args;
		const itemGroupName = item.Asset?.Group?.Name as AssetGroupItemName;
		if (isDeviousLock(item) && (target.IsPlayer() || target.DOGS)) {
			if (
				target.IsPlayer() &&
				!modStorage.deviousPadlock.itemGroups?.[itemGroupName]
			) {
				registerDeviousPadlockInModStorage(itemGroupName, Number(item.Property.LockMemberNumber ?? Player.MemberNumber));
			}
			// Keep the game's current interaction gate here, but do not mix it into
			// the stored role permission check used by room-sync reconciliation.
			return Player.CanInteract() && hasKeyToPadlock(item.Asset.Group.Name as AssetGroupItemName, Player, target);
		}
		return next(args);
	});

	hookFunction("InventoryUnlock", HookPriority.ADD_BEHAVIOR, (args, next) => {
		const [target, itemOrGroupName] = args;
		const item = typeof itemOrGroupName === "string" ? InventoryGet(target, itemOrGroupName) : itemOrGroupName;
		const groupName = typeof itemOrGroupName === "string"
			? itemOrGroupName as AssetGroupItemName
			: item?.Asset?.Group?.Name as AssetGroupItemName | undefined;
		const padlockSettings = groupName ? getPadlockSettings(target, groupName) : null;
		const isManagedDeviousLock = !!item && (isDeviousLock(item) || !!padlockSettings);
		if (
			internalPadlockUnlockDepth === 0 &&
			isManagedDeviousLock &&
			(target.IsPlayer() || target.DOGS) &&
			groupName &&
			!hasKeyToPadlock(groupName, Player, target)
		) {
			return undefined as never;
		}
		const wasDeviousLock = !!item && isDeviousLock(item);
		const result = next(args);
		if (wasDeviousLock && groupName) {
			const unlockedItem = InventoryGet(target, groupName);
			if (unlockedItem && !Object.values(BasePadlock).includes(unlockedItem.Property?.LockedBy as BasePadlock)) {
				unmarkDeviousPadlock(unlockedItem);
			}
			if (target.IsPlayer()) {
				// Verify direct or cheat-command unlocks too, even if no room packet follows.
				void Promise.resolve()
					.then(() => checkDeviousPadlocks(Player))
					.catch((error) => logger.warn("Devious padlock unlock check failed:", error));
			}
		}
		return result;
	});

	hookFunction("InventoryLock", HookPriority.ADD_BEHAVIOR, (args, next) => {
		const [C, itemOrGroupName, lock] = args as [Character, Item | AssetGroupName, Item | AssetLockType];
		const lockName = typeof lock === "string" ? lock : lock.Asset?.Name;
		if (!isKnownPadlockName(lockName)) return next(args);

		const item = typeof itemOrGroupName === "string"
			? InventoryGet(C, itemOrGroupName as AssetGroupItemName)
			: itemOrGroupName;
		// InventoryLock refreshes/saves the character before it returns. Mark first so
		// the native account and room bundles contain the supported LockMessage marker.
		if (item && InventoryDoesItemAllowLock(item)) markDeviousPadlock(item);
		args[2] = BasePadlock.EXCLUSIVE;
		const result = next(args);
		const resultingItem = typeof itemOrGroupName === "string"
			? InventoryGet(C, itemOrGroupName as AssetGroupItemName)
			: itemOrGroupName;
		if (resultingItem?.Property?.LockedBy === BasePadlock.EXCLUSIVE) markDeviousPadlock(resultingItem);
		return result;
	});

	hookFunction("ItemPropertiesCompress", HookPriority.ADD_BEHAVIOR, (args, next) => {
		const item = args[0] as Item | undefined;
		const result = next(args);

		if (!result || typeof result !== "object") return result;

		if (
			item?.Property?.IsDeviousLock === true ||
			(typeof item?.Property?.LockMessage === "string" && item.Property.LockMessage.startsWith(DEVIOUS_PADLOCK_MARKER))
		) {
			(result as Record<string, unknown>).IsDeviousLock = true;
			const lockMessage = (result as Record<string, unknown>).LockMessage;
			if (typeof lockMessage !== "string" || !lockMessage.startsWith(DEVIOUS_PADLOCK_MARKER)) {
				(result as Record<string, unknown>).LockMessage = DEVIOUS_PADLOCK_MARKER + (item?.Property?.LockMessage ?? "");
			}
		}

		return result;
	});

	hookFunction("ItemPropertiesDecompress", HookPriority.ADD_BEHAVIOR, (args, next) => {
		const item = args[0] as Item | undefined;
		const properties = args[1] as ItemPropertiesMinimized | undefined;
		const result = next(args);

		if (!item?.Property) return result;

		const lockedBy = item.Property.LockedBy;
		const isBaseLock =
			!!lockedBy && Object.values(BasePadlock).includes(lockedBy as BasePadlock);

		if (!isBaseLock) return result;

		const groupName = item.Asset?.Group?.Name as AssetGroupItemName | undefined;
		const fromPayload = properties != null && (properties as Record<string, unknown>).IsDeviousLock === true;
		const fromItem = item.Property.IsDeviousLock === true;
		const fromMarker =
			typeof item.Property.LockMessage === "string" &&
			item.Property.LockMessage.startsWith(DEVIOUS_PADLOCK_MARKER);
		const fromStorage =
			!!groupName && !!modStorage.deviousPadlock?.itemGroups?.[groupName];

		if (fromPayload || fromItem || fromMarker || fromStorage) {
			markDeviousPadlock(item);
		}
		return result;
	});

	hookFunction("DialogSetStatus", HookPriority.ADD_BEHAVIOR, (args, next) => {
		const C = CurrentCharacter!;
		const [status] = args;
		if (
			typeof status === "string" &&
			status.startsWith("This looks like its locked by a") &&
			isDeviousLock(InventoryGet(C, C.FocusGroup!.Name)) &&
			(C.IsPlayer() || C.DOGS)
		) {
			if (C.IsPlayer()) {
				args[0] = "This looks like its locked by a devious padlock, you are totally helpless :3";
			} else {
				args[0] = `This looks like its locked by a devious padlock, ${getNickname(C)} is totally helpless :3`;
			}
		}
		return next(args);
	});

	hookFunction("ChatRoomCharacterItemUpdate", HookPriority.OBSERVE, (args, next) => {
		if (remoteControlIsInteracting) return;
		const ret = next(args);
		const [target, group] = args;
		onAppearanceChange(Player, target);
		return ret;
	});

	hookFunction("ChatRoomSyncItem", HookPriority.OBSERVE, (args, next) => {
		next(args);
		const [data] = args;
		const item = data?.Item;
		const target1 = getPlayer(data?.Source);
		const target2 = getPlayer(item?.Target);
		if (!target1 || !target2) return;
		onAppearanceChange(target1, target2);
	});

	hookFunction("ChatRoomSyncSingle", HookPriority.OBSERVE, (args, next) => {
		next(args);
		const [data] = args;
		const target1 = getPlayer(data?.SourceMemberNumber);
		const target2 = getPlayer(data?.Character?.MemberNumber);
		if (!target1 || !target2) return;
		onAppearanceChange(target1, target2);
	});

	hookFunction("ElementButton.CreateForAsset", HookPriority.OBSERVE, (args, next) => {
		args[4] ??= {};
		const asset: Asset = "Asset" in args[1] ? args[1].Asset : args[1];
		switch (asset.Name) {
			case COMPAT_PADLOCK_NAME:
			case PACT_PADLOCK_NAME:
				args[4].image = pactPadlockImage;
				break;
		}
		return next(args);
	});

	hookFunction("DialogInventoryAdd", HookPriority.ADD_BEHAVIOR, (args, next) => {
		const [C, item, isWorn, sortOrder] = args;
		const asset = item.Asset;

		if (
			isKnownPadlockName(asset.Name) &&
			!C.IsPlayer() &&
			!C.DOGS
		) return;
		return next(args);
	});

	interface DeviousInventoryIcon {
		name: string;
		iconSrc: string;
		tooltipText: String;
	}

	hookFunction("DialogGetLockIcon", HookPriority.ADD_BEHAVIOR, (args, next) => {
		const item: Item = args[0];
		if (InventoryItemHasEffect(item, "Lock")) {
			if (isDeviousLock(item)) {
				const icon: DeviousInventoryIcon = {
					name: PACT_PADLOCK_NAME,
					iconSrc: pactPadlockImage,
					tooltipText: getText("common.lock_tooltip")
				};
				// Cursed, but we're returning our own icon data here
				return [icon] as unknown as InventoryIcon[];
			}
		}
		return next(args);
	});

	hookFunction("InventoryIsPermissionBlocked", HookPriority.ADD_BEHAVIOR, (args, next) => {
		const [C, AssetName, AssetGroup, AssetType] = args;
		if (isKnownPadlockName(AssetName)) return !canPutDeviousPadlock(AssetGroup as AssetGroupItemName, Player, C);
		return next(args);
	});

	hookFunction("InventoryTogglePermission", HookPriority.ADD_BEHAVIOR, (args, next) => {
		const item: Item = args[0];
		if (isKnownPadlockName(item.Asset.Name)) return undefined as never;
		return next(args);
	});

	// Fixing Preview Screen
	hookFunction("DrawPreviewIcons", HookPriority.ADD_BEHAVIOR, (args, next) => {
		const icons = args[0];
		if (CommonIsArray(icons)) args[0] = icons.map((i: InventoryIcon | DeviousInventoryIcon) => typeof i === "string" ? i : i.name as InventoryIcon);
		return next(args);
	});

	hookFunction("DrawImageResize", HookPriority.ADD_BEHAVIOR, (args, next) => {
		const src = args[0];
		if (typeof src === "string" && src.includes("Preview")) {
			const baseName = src.split("/").pop()?.replace(".png", "");
			if (isKnownPadlockName(baseName)) args[0] = pactPadlockImage;
		}
		return next(args);
	});

	hookFunction("DialogExtendItem", HookPriority.ADD_BEHAVIOR, (args, next) => {
		const [item, sourceItem] = args;
		if (sourceItem && isDeviousLock(sourceItem)) {
			const itemGroup = AssetGroupGet(CurrentCharacter?.AssetFamily ?? Player.AssetFamily, sourceItem.Asset.Group.Name);
			if (itemGroup?.IsItem()) {
				void inspectDeviousPadlock(CurrentCharacter, itemGroup);
				return;
			}
		}
		return next(args);
	});

	hookFunction("CommandExecute", HookPriority.ADD_BEHAVIOR, (args, next) => {
		if (modStorage.deviousPadlock.itemGroups === undefined || Object.keys(modStorage.deviousPadlock.itemGroups).length === 0) return next(args);
		for (const _itemGroup in modStorage.deviousPadlock.itemGroups ?? {}) {
			const itemGroup = _itemGroup as AssetGroupItemName;
			if (getPadlockSettings(Player, itemGroup)?.preventCheatCommands) {
				break;
			} else {
				const len = Object.keys(modStorage.deviousPadlock.itemGroups!).length;
				if (itemGroup === Object.keys(modStorage.deviousPadlock.itemGroups!)[len - 1]) {
					return next(args);
				}
			}
		}
		const command = args[0].toLowerCase().trim();
		let prevent = false;
		KNOWN_CHEAT_COMMANDS.forEach((c) => {
			if (command?.startsWith(c)) {
				sendLocalizedAction("actions.action_cheat_blocked", { name: getNickname(Player), cmd: c });
				return prevent = true;
			}
		});
		if (prevent) return false;
		return next(args);
	});

	hookFunction("TextLoad", HookPriority.OVERRIDE_BEHAVIOR, (args, next) => {
		if ((CurrentScreen as string) === "InspectDeviousPadlock") {
			return undefined as never;
		}
		return next(args);
	});
}
