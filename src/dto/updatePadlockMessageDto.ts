import { BasePadlock, DeviousPadlockUpdateData, KeyHolderMinimumRole } from "src/modules/deviousPadlock";
import { IsArray, IsBoolean, isEnum, IsIn, IsNumber, IsOptional, IsString, Matches, Type, ValidateNested, } from "zois-core/validation";
import { ValidateWith } from "./decorators";

class CombinationToLockDto {
    @IsIn(["PIN-Code", "password"])
    type!: "PIN-Code" | "password";

    @IsString()
    @Matches(/^[a-zA-Z0-9!@#$%^&*]+$/, {
        message: "密码包含无效字符"
    })
    value!: string;
}

export class PadlockConfigDto implements DeviousPadlockUpdateData {
    @IsOptional()
    @ValidateWith((dto) => isEnum(dto.baseLock, BasePadlock))
    baseLock?: BasePadlock;

    @IsOptional()
    @ValidateWith((dto) => isEnum(dto.minimumRole, KeyHolderMinimumRole))
    minimumRole?: KeyHolderMinimumRole;

    @IsOptional()
    @IsArray()
    @IsNumber({}, { each: true })
    memberNumbers?: number[];

    @IsOptional()
    @IsString()
    note?: string;

    @IsOptional()
    @IsBoolean()
    preventCheatCommands?: boolean;

    @IsOptional()
    @IsString()
    @ValidateWith((obj: PadlockConfigDto) => {
        const date = new Date(obj.unlockTime ?? "");
        return !isNaN(date.getTime());
    }, { message: "解锁时间必须是有效的日期时间" })
    unlockTime?: string;

    @IsOptional()
    @Type(() => CombinationToLockDto)
    @ValidateNested()
    combinationToLock?: CombinationToLockDto

    @IsOptional()
    @IsString()
    combinationToUnlock?: string
}

export class UpdatePadlockMessageDto {
    @IsString()
    @ValidateWith((obj) => {
        const g = AssetGroupGet("Female3DCG", obj.groupName);
        return !!g && g.IsItem();
    })
    groupName!: AssetGroupItemName;

    @Type(() => PadlockConfigDto)
    @ValidateNested()
    config!: PadlockConfigDto;
}