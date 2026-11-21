# 锁契 · PACT

**Padlock Authorization & Covenant Toolkit** · 挂锁授权与契约工具集

Bondage Club 中文挂锁插件。功能与狗锁（DOGS）兼容，界面全中文，由中文社区自行维护与适配，不再等待外国作者更新。

## 名字的含义

| 字母 | 英文 | 中文 | 含义 |
|---|---|---|---|
| **P** | Padlock | 挂锁 | 核心功能 |
| **A** | Authorization | 授权 | 钥匙权限、锁具管理、远程授权 |
| **C** | Covenant | 契约 | 双方建立的约定与锁定关系 |
| **T** | Toolkit | 工具集 | 为日后加入其他 BC 功能留出扩展空间 |

## 功能

- **契锁**：佩戴者自己无法取下的挂锁，可配置钥匙持有人、最低身份、成员编号、备注、定时解锁、密码、防作弊
- **配置方案**：保存并批量应用锁的设置
- **远程控制**：被授权者可远程改变外观（后续版本）
- **完全兼容狗锁协议**：能识别并处理别人身上的狗锁，反之亦然

## 安装

### Tampermonkey（推荐）

一键安装：[点此安装 锁契 · PACT](https://raw.githubusercontent.com/heitaoplay/PACT/main/pact.user.js)

安装后油猴会自动检查更新，以后发新版无需手动重装。

###  bookmarks（备用）

把 `pact.user.js` 的内容存成浏览器书签即可。

## 开发

```bash
pnpm install       # 安装依赖
pnpm build         # 生产构建
pnpm build:dev     # 开发构建
pnpm dev           # 本地开发服务器 + 自动安装加载器
```

## 开源与署名

本项目采用 **GPL-3.0** 协议开源。

代码基于以下项目，保留原作者署名与版权声明：

- **FurryZoi/Devious-Obligate-Great-Stuff**（DOGS 原版，作者 Ziro / Zoi）
- **Latte-maker/Devious-Obligate-Great-Stuff**（拿铁的 R134 修复版，作者 拿鐵 Latte）

底层锁协议、身份标记、消息字段与原版保持一致，以确保与狗锁互通。中文品牌、界面、语言包由本项目独立维护。
