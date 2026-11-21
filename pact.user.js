// ==UserScript==
// @name         锁契 · PACT
// @namespace    https://github.com/heitaoplay/PACT
// @version      1.0.0
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
    s.src = "https://heitaoplay.github.io/PACT/bundle.js?v=1.0.0";
    s.onload = () => s.remove();
    document.head.appendChild(s);
})();
