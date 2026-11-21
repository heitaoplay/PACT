import { build } from "esbuild";
import fs from "fs";
import copy from "esbuild-plugin-copy";
import chalk from "chalk";
import path from "path";

const args = process.argv.slice(2);

if (fs.existsSync("dist")) fs.rmSync("dist", { recursive: true, force: true });
else fs.mkdirSync("dist");

function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

await build({
    entryPoints: ["./src/index.ts"],
    bundle: true,
    sourcemap: true,
    outfile: "./dist/bundle.js",
    loader: {
        ".ts": "ts",
        ".css": "text",
        ".png": "dataurl",
        ".svg": "dataurl",
        ".ttf": "dataurl",
    },
    platform: "browser",
    format: "iife",
    tsconfig: "./tsconfig.json",
    define: {
        IS_DEV: args.includes("--dev") ? "true" : "false"
    },
    banner: {
        js: `// 锁契 · PACT — Padlock Authorization & Covenant Toolkit
// GPL-3.0 · 基于 FurryZoi/DOGS 与 Latte-maker 修复版，保留原作者署名
if (typeof window.ImportBondageCollege !== "function") {
  alert("Club not detected! Please only use this while you have Club open!");
  throw "Dependency not met";
}`
    },
    plugins: [
        copy({
            resolveFrom: "cwd",
            assets: {
                from: ["./localization/*"],
                to: ["./dist/localization"]
            }
        })
    ]
}).catch(() => process.exit(1));

// 生成 Tampermonkey 安装脚本（放仓库根目录，供一键安装 / 自动更新）
// 真正代码从 GitHub Pages 的 bundle.js 加载，带版本号做缓存穿透
const pkgVersion = JSON.parse(fs.readFileSync("./package.json", "utf8")).version;
const userscript = `// ==UserScript==
// @name         锁契 · PACT
// @namespace    https://github.com/heitaoplay/PACT
// @version      ${pkgVersion}
// @description  挂锁授权与契约工具集 — 中文狗锁兼容插件
// @author       锁契 · PACT 中文社区维护者
// @license      GPL-3.0-only
// @homepageURL  https://github.com/heitaoplay/PACT
// @updateURL    https://raw.githubusercontent.com/heitaoplay/PACT/main/pact.user.js
// @downloadURL  https://raw.githubusercontent.com/heitaoplay/PACT/main/pact.user.js
// @match        https://*.bondageprojects.elementfx.com/*
// @match        https://*.bondage-europe.com/*
// @match        https://*.bondageeurope.com/*
// @match        https://*.bondageprojects.com/*
// @match        https://*.bondage-asia.com/club/*
// @match        http://localhost:*/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
    const s = document.createElement("script");
    s.setAttribute("language", "JavaScript");
    s.setAttribute("crossorigin", "anonymous");
    s.src = "https://heitaoplay.github.io/PACT/bundle.js?v=${pkgVersion}";
    s.onload = () => s.remove();
    document.head.appendChild(s);
})();
`;
fs.writeFileSync("./pact.user.js", userscript, "utf8");
console.log(chalk.green("+ pact.user.js (Tampermonkey 安装脚本)"));

console.log(chalk.green("Build completed:\n"));
const files = fs.readdirSync("dist", { recursive: true, withFileTypes: true });
for (const file of files) {
    if (file.isFile()) {
        const { size } = fs.statSync(path.join(file.parentPath, file.name));
        console.log(chalk.magenta("+") + " " + chalk.yellow(file.parentPath) + "/" + chalk.cyan(file.name) + " " + chalk.grey(formatSize(size)))
    }
}

if (args.includes("--dev")) {
    console.log(chalk.grey("\nDevelopment Build"))
} else {
    console.log(chalk.grey("\nProduction Build (Add --dev to make development build)"));
}