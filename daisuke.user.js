// ==UserScript==
// @name         Evade by skipped.lol
// @namespace    http://tampermonkey.net/
// @version      2.2.25
// @description  A client-sided bypass for work.ink.
// @author       skipped.lol
//
// @match        https://*.work.ink/*
// @match        http://*.work.ink/*
// @match        https://work.ink/*
// @match        http://work.ink/*
//
// @match        https://cuttlinks.com/*
//
// @match        https://shrtslug.biz/*
// @match        https://biovetro.net/*
// @match        https://technons.com/*
// @match        https://yrtourguide.com/*
// @match        https://tournguide.com/*
//
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
//
// @run-at       document-start
//
// @homepageURL  https://skipped.lol/
// ==/UserScript==

if (window.self !== window.top) {
    return;
}

(function () {
    "use strict";

    const VERSION = "2.2.23";
    const currentUrl = location.href;
    const sessionId = Math.random().toString(36).substring(2, 15);
    const NEGOTIATE_API = "https://skipped.lol/api/evade/negotiate";
    const INIT_API = "https://skipped.lol/api/evade/init";
    const OriginalWebSocket = unsafeWindow.WebSocket;

    let authData = null;
    const originalAddEventListener = Element.prototype.addEventListener;
    const host = location.hostname;

    const serviceType = host.includes("work.ink") ? "workink" :
        host.includes("lootdest.org") || host.includes("loot-links.com") || host.includes("loot-link.com") ? "lootlabs" :
        host.includes("linkvertise.com") ? "linkvertise" :
        host.includes("cuttlinks.com") ? "cuty" :
        host.includes("rekonise.com") ? "rekonise" :
        host.includes("shrtslug.biz") || host.includes("biovetro.net") || host.includes("technons.com") || host.includes("yrtourguide.com") || host.includes("tournguide.com") ? "shortfly" :
        "unknown";

    let isInterceptingWs = false;

    // WebSocket Hijack for work.ink
    if (serviceType === "workink") {
        unsafeWindow.WebSocket = function (url, protocols) {
            if (!isInterceptingWs && url?.includes("work.ink")) {
                return {
                    readyState: 3,
                    send: () => {},
                    close: () => {},
                    addEventListener: () => {},
                    removeEventListener: () => {},
                    onopen: null,
                    onclose: null,
                    onmessage: null,
                    onerror: null
                };
            }
            return new OriginalWebSocket(url, protocols);
        };
        unsafeWindow.WebSocket.prototype = OriginalWebSocket.prototype;
        unsafeWindow.WebSocket.CONNECTING = 0;
        unsafeWindow.WebSocket.OPEN = 1;
        unsafeWindow.WebSocket.CLOSING = 2;
        unsafeWindow.WebSocket.CLOSED = 3;
    }

    let evadeForcefullyStarted = false;
    let isBypassed = false;
    let updateRequired = false;

    let linkInfo = null;
    let emMessage = null;
    let wsInstance = null;
    let forceEvadeTimer = null;
    let pingTimer = null;
    let connectionTimeout = null;

    let socialPromiseControls = null;
    let destinationControls = null;
    let monetizationDoneControls = null;
    let monetizationAckControls = null;
    let offersStateControls = null;

    if (unsafeWindow.__EV_INITIALIZED__) return;
    unsafeWindow.__EV_INITIALIZED__ = true;

    const DEFAULT_MIN_TIME = 20;
    const DEFAULT_AURORA = true;
    const DEFAULT_NEW_TAB = true;

    const getSettings = () => ({
        minimumTime: GM_getValue("minimumTime", GM_getValue("safetyDelay", DEFAULT_MIN_TIME)),
        auroraBackground: GM_getValue("auroraBackground", DEFAULT_AURORA),
        openNewTab: GM_getValue("openNewTab", DEFAULT_NEW_TAB)
    });

    let bypassStartTime = null;

    function createTimeoutPromise(controls, timeoutMs, shouldReject = true) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                controls.fn = null;
                if (shouldReject) {
                    reject();
                } else {
                    resolve(null);
                }
            }, timeoutMs);

            controls.fn = (result) => {
                clearTimeout(timer);
                controls.fn = null;
                resolve(result);
            };
        });
    }

    const waitSocial = (time = 30000) => {
        const controls = {};
        socialPromiseControls = controls;
        return createTimeoutPromise(controls, time);
    };

    const waitMonetizationDone = (time = 140000) => {
        const controls = {};
        monetizationDoneControls = controls;
        return createTimeoutPromise(controls, time);
    };

    const waitOffersState = (time = 20000) => {
        const controls = {};
        offersStateControls = controls;
        return createTimeoutPromise(controls, time);
    };

    const waitDestination = (time = 180000) => {
        const controls = {};
        destinationControls = controls;
        return createTimeoutPromise(controls, time, false);
    };

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    function sendWsMessage(msg) {
        if (wsInstance?.readyState === 1) {
            wsInstance.send(msg);
        }
    }

    async function processLinkInfo(info) {
        const { fM, flM, sM, raM, osM, osM2, mM, coM, pinger, envC, mUrl } = info;

        if (envC) sendWsMessage(envC);
        if (pinger) sendWsMessage(pinger);

        if (sM?.length) {
            for (let i = 0; i < sM.length; i++) {
                updateStatus(`Completing social ${i + 1}/${sM.length}...`);
                sendWsMessage(sM[i].encrypted || sM[i]);
                if (flM) sendWsMessage(flM);
                try { await waitSocial(30000); } catch {}
                await sleep(1000);
                if (fM) sendWsMessage(fM);
            }
        }

        if (raM?.length) {
            updateStatus("Sending readArticles...");
            for (const article of raM) {
                sendWsMessage(article.encrypted || article);
            }
        }

        if (raM?.length) {
            updateStatus("Waiting for offer information...");
            try { await waitOffersState(20000); } catch {}
            if (isBypassed) return;
        }

        if (isBypassed) return;

        const monetizationList = [
            ...(mM || []).map(item => ({ ...item, source: "monetization" })),
            ...(coM || []).map(item => ({ ...item, source: "customOffer" }))
        ].sort((a, b) => a.id - b.id);

        if (osM?.length) {
            [...osM].sort((a, b) => a.id - b.id);
        }

        const processedIds = new Set();

        for (let i = 0; i < monetizationList.length; i++) {
            const item = monetizationList[i];
            const payload = item.encrypted || JSON.stringify(item);

            processedIds.add(item.id);

            if (item.source === "customOffer") {
                updateStatus(`Processing ${item.name}...`);
                sendWsMessage(item.initEncrypted);
                sendWsMessage(item.startEncrypted);
                if (flM) sendWsMessage(flM);

                const customUrl = mUrl?.find((u => String(u.ID) === String(item.id)));
                if (customUrl?.OfferUrl) {
                    const iframe = document.createElement("iframe");
                    iframe.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden;";
                    iframe.src = customUrl.OfferUrl;
                    document.body.appendChild(iframe);
                    setTimeout(() => iframe.remove(), 5000);
                }

                await sleep(500);
                if (fM) sendWsMessage(fM);

                try { await waitMonetizationDone(140000); } catch {}
                await sleep(1000);

            } else if (item.id === 80) {
                updateStatus("Processing Stake offer...");
                sendWsMessage(payload);
                try { await waitMonetizationDone(140000); } catch {}

            } else if (item.id === 25 || item.id === 34) {
                if (item.event === "start") {
                    updateStatus(item.id === 25 ? "Processing Opera..." : "Processing browser task (can take upto 2 mins)...");
                    sendWsMessage(payload);

                    const installClick = monetizationList.find(e => e.id === item.id && e.event === "installClicked");
                    if (installClick) sendWsMessage(installClick.encrypted || JSON.stringify(installClick));

                    const waitPromise = waitMonetizationDone(140000);
                    let success = false;

                    if (item.id === 25) {
                        try {
                            updateStatus("Forcefully Evading #3...");
                            document.cookie = "__cf_bm=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=.work.ink;";
                            document.cookie = "__cf_bm=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=work.ink;";

                            const headReq = await new Promise((resolve, reject) => {
                                GM_xmlhttpRequest({
                                    method: "HEAD",
                                    url: "https://work.ink/_api/v2/affiliate/operaGX",
                                    headers: { "User-Agent": "Opera Installer/1.0" },
                                    onload: resolve,
                                    onerror: reject,
                                    timeout: 3000
                                });
                            });

                            const cfCookieMatch = headReq.responseHeaders?.match(/__cf_bm=([^;\s]+)/);
                            const cookieHeader = cfCookieMatch ? `__cf_bm=${cfCookieMatch[1]}` : "";

                            const postReq = await new Promise((resolve, reject) => {
                                GM_xmlhttpRequest({
                                    method: "POST",
                                    url: "https://work.ink/_api/v2/callback/operaGX",
                                    headers: {
                                        "Content-Type": "application/json",
                                        "User-Agent": "Opera Installer/1.0",
                                        ...(cookieHeader && { Cookie: cookieHeader })
                                    },
                                    data: JSON.stringify({ noteligible: true }),
                                    onload: resolve,
                                    onerror: reject,
                                    timeout: 3000
                                });
                            });

                            if (postReq.status === 200) {
                                success = true;
                                await sleep(1200);
                            } else {
                                updateStatus("Opera task running (may take upto 2 mins)...");
                            }
                        } catch (e) {
                            updateStatus("Opera task running (may take upto 2 mins)...");
                        }
                    }

                    if (isBypassed) continue;
                    if (flM) sendWsMessage(flM);

                    try { await waitPromise; } catch {}
                    if (fM) sendWsMessage(fM);
                }
            } else {
                sendWsMessage(payload);
                await sleep(500);
            }

            if (isBypassed) return;
            if (i < monetizationList.length - 1 && isBypassed) return;
        }

        if (fM) sendWsMessage(fM);
        updateStatus("Waiting for destination...");
        
        if (!(await waitDestination())) {
            updateStatus("Bypass timed out. Please refresh.");
        }
    }

    function connectWorkInkWS(userId, customId, referrerParam, monocleData) {
        let sessionToken = "";
        if (authData) {
            sessionToken = authData.tok;
            if (sessionToken === "") {
                isBypassed = true;
                updateStatus("Failed to authenticate. Please report this in Discord. [EV-CTK-001]");
                return;
            }
        }

        const wsUrl = `wss://work.ink/_api/v2/ws?userId=${userId}&custom=${customId}&referrer=https://work.ink/&toLink=&serverOverride=${referrerParam}&customerSessionToken=${sessionToken}&monocleAssessment=${monocleData || ""}`;
        
        isInterceptingWs = true;
        wsInstance = new OriginalWebSocket(wsUrl);
        isInterceptingWs = false;

        connectionTimeout = setTimeout(() => {
            if (!linkInfo && !isBypassed) {
                updateStatus("work.ink failed to respond. Please refresh.");
            }
        }, 15000);

        wsInstance.onopen = () => {
            if (authData) {
                if (authData.mcl) sendWsMessage(authData.mcl);
                if (authData.pinger) sendWsMessage(authData.pinger);
            }
            updateStatus("Connected, waiting for link info...");
        };

        wsInstance.onmessage = (e) => {
            if (typeof e.data === "string") {
                const messageData = e.data;
                if (isBypassed || updateRequired) return;

                GM_xmlhttpRequest({
                    method: "POST",
                    url: NEGOTIATE_API,
                    headers: { "Content-Type": "application/json" },
                    data: JSON.stringify({
                        demands: messageData,
                        direction: "incoming",
                        session_id: sessionId,
                        client_timestamp: Date.now()
                    }),
                    onload: function (resp) {
                        if (isBypassed) return;
                        try {
                            const parsed = JSON.parse(resp.responseText);
                            if (!parsed) {
                                updateStatus("Backend failed to respond, retrying...");
                                return;
                            }

                            if (parsed.success === false && parsed.error) {
                                updateStatus(parsed.error);
                                isBypassed = true;
                                return;
                            }

                            if (parsed.conditions === "destination" && parsed.destinationURL) {
                                isBypassed = true;
                                if (destinationControls?.fn) destinationControls.fn(parsed.destinationURL);

                                const minTime = getSettings().minimumTime;
                                const timeElapsed = bypassStartTime ? Math.floor((Date.now() - bypassStartTime) / 1000) : 0;
                                const waitRemaining = Math.max(0, minTime - timeElapsed);

                                if (waitRemaining > 0) {
                                    let secs = waitRemaining;
                                    updateStatus(`Bypass complete! Waiting ${secs}s...`);
                                    const timerInterval = setInterval(() => {
                                        secs--;
                                        if (secs > 0) {
                                            updateStatus(`Bypass complete! Waiting ${secs}s...`);
                                        } else {
                                            clearInterval(timerInterval);
                                            showDestinationButton(parsed.destinationURL);
                                        }
                                    }, 1000);
                                } else {
                                    showDestinationButton(parsed.destinationURL);
                                }
                                return;
                            }

                            if (parsed.conditions === "prxd") {
                                if ((bypassStartTime ? Date.now() - bypassStartTime : 0) < 9000) {
                                    updateStatus("work.ink has detected your VPN/Proxy. Please disable and retry to bypass this link. [EV-PRX-001]");
                                    isBypassed = true;
                                }
                                return;
                            }

                            if (parsed.conditions === "social_done" && socialPromiseControls?.fn) socialPromiseControls.fn();
                            if (parsed.conditions === "monetization_done" && monetizationDoneControls?.fn) monetizationDoneControls.fn();
                            if (parsed.conditions === "monetization_ack" && monetizationAckControls?.fn) monetizationAckControls.fn(parsed);
                            if (parsed.conditions === "offers_state" && offersStateControls?.fn) offersStateControls.fn(parsed);

                            if (parsed.conditions === "ping" && parsed.pingMsg && !pingTimer) {
                                pingTimer = setTimeout(() => {
                                    sendWsMessage(parsed.pingMsg);
                                    pingTimer = null;
                                }, 2000);
                            }

                            if (parsed.em) emMessage = parsed.em;

                            if (parsed.sM?.length || parsed.raM?.length || parsed.osM?.length || parsed.mM?.length || parsed.coM?.length || parsed.hasOwnProperty("sM")) {
                                updateStatus("Received link info, forcefully evading...");
                                if (connectionTimeout) {
                                    clearTimeout(connectionTimeout);
                                    connectionTimeout = null;
                                }

                                if (evadeForcefullyStarted) {
                                    processLinkInfo(parsed);
                                } else {
                                    linkInfo = parsed;
                                    if (emMessage && !forceEvadeTimer) {
                                        forceEvadeTimer = setTimeout(() => {
                                            if (!evadeForcefullyStarted && emMessage) {
                                                updateStatus("Forcefully Evading...");
                                                sendWsMessage(emMessage);
                                                evadeForcefullyStarted = true;
                                                
                                                if (forceEvadeTimer) {
                                                    clearTimeout(forceEvadeTimer);
                                                    forceEvadeTimer = null;
                                                }
                                                if (linkInfo) {
                                                    processLinkInfo(linkInfo);
                                                    linkInfo = null;
                                                }
                                            }
                                        }, 1000);
                                    }
                                }
                            }
                        } catch (e) {
                            updateStatus("Backend parse error. Check console.");
                        }
                    },
                    onerror: function () {
                        updateStatus("Backend request failed. Please refresh.");
                    },
                    ontimeout: function () {
                        updateStatus("Backend request timed out. Please refresh.");
                    },
                    timeout: 30000
                });
            }
        };

        wsInstance.onerror = (e) => {
            if (!isBypassed) updateStatus("Connection error. Please refresh.");
        };

        wsInstance.onclose = (e) => {
            if (!isBypassed) updateStatus(`Connection closed: ${e.code}`);
        };
    }

    async function checkUpdates() {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: "https://skipped.lol/api/evade/version",
                timeout: 5000,
                onload: function (resp) {
                    try {
                        const parsed = JSON.parse(resp.responseText);
                        if (parsed.version && parsed.version !== VERSION) {
                            updateRequired = true;
                            isBypassed = true;
                            updateStatus(`Update required! v${VERSION} → v${parsed.version}`);
                            const statusEl = document.getElementById("evade-status");
                            if (statusEl) {
                                statusEl.innerHTML = `Update required! v${VERSION} → v${parsed.version}. <a href="https://skipped.lol/evade/evade.user.js" style="color:#4c82af;text-decoration:underline;">Update</a>`;
                            }
                            return resolve(false);
                        }
                    } catch (e) {}
                    resolve(true);
                },
                onerror: () => resolve(true),
                ontimeout: () => resolve(true)
            });
        });
    }

    function clearPage() {
        document.documentElement.innerHTML = "";
        document.documentElement.appendChild(document.createElement("head"));
        document.documentElement.appendChild(document.createElement("body"));
    }

    function createUIOverlay() {
        const settings = getSettings();
        
        const fontLink = document.createElement("link");
        fontLink.rel = "stylesheet";
        fontLink.href = "https://fonts.googleapis.com/css2?family=Poppins:wght@400;600&display=swap";
        document.head.appendChild(fontLink);

        const styleBlock = document.createElement("style");
        styleBlock.textContent = `
            #evade-overlay, #evade-overlay * { font-family: Poppins, sans-serif !important; -webkit-user-select: auto; user-select: auto; }
            #evade-overlay { pointer-events: auto; }
            #evade-overlay button, #evade-overlay a { pointer-events: auto !important; cursor: pointer !important; }
            .evade-orb { position: absolute; border-radius: 50%; filter: blur(80px); pointer-events: none !important; }
            .evade-orb-1 { width: 600px; height: 600px; top: -15%; left: -10%; background: radial-gradient(circle, rgba(45,90,120,0.7) 0%, rgba(30,60,80,0.4) 40%, transparent 70%); animation: of1 22s ease-in-out infinite; }
            .evade-orb-2 { width: 500px; height: 500px; bottom: -20%; right: -5%; background: radial-gradient(circle, rgba(60,110,140,0.65) 0%, rgba(40,80,100,0.35) 45%, transparent 70%); animation: of2 25s ease-in-out infinite; }
            .evade-orb-3 { width: 450px; height: 450px; top: 50%; left: 60%; transform: translate(-50%,-50%); background: radial-gradient(circle, rgba(55,100,130,0.6) 0%, rgba(35,70,95,0.3) 50%, transparent 70%); animation: of3 18s ease-in-out infinite; }
            .evade-card { width: 320px; padding: 2.5rem 2rem; text-align: center; position: relative; z-index: 10; pointer-events: auto; }
            .evade-card-aurora { background: rgba(20,30,45,0.65); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); }
            .evade-status { font-size: 16px; margin-top: 20px; opacity: 0.8; line-height: 1.5; }
            @keyframes fi { from { opacity: 0; } to { opacity: 1; } }
            @keyframes of1 { 0%, 100% { transform: translate(0,0) scale(1); } 50% { transform: translate(30px,20px) scale(1.05); } }
            @keyframes of2 { 0%, 100% { transform: translate(0,0) scale(1); } 50% { transform: translate(-40px,-30px) scale(1.08); } }
            @keyframes of3 { 0%, 100% { transform: translate(-50%,-50%) scale(1); } 50% { transform: translate(-45%,-55%) scale(1.03); } }
        `;
        document.head.appendChild(styleBlock);

        const overlayDiv = document.createElement("div");
        overlayDiv.id = "evade-overlay";
        
        const cardClass = settings.auroraBackground ? "evade-card evade-card-aurora" : "evade-card";
        const backgroundStyle = settings.auroraBackground ? "background:radial-gradient(ellipse at center, #1a2530 0%, #0f1a22 50%, #0a1015 100%)" : "background:#1a1a1a";
        const orbsHtml = settings.auroraBackground ? '<div class="evade-orb evade-orb-1"></div><div class="evade-orb evade-orb-2"></div><div class="evade-orb evade-orb-3"></div>' : "";

        overlayDiv.innerHTML = `
            <div style="position:fixed; top:0; left:0; width:100%; height:100%; ${backgroundStyle}; z-index:999999; display:flex; justify-content:center; align-items:center; color:white; overflow:hidden;">
                ${orbsHtml}
                <div class="${cardClass}">
                    <h1 style="font-size:48px; margin:0 0 8px; animation:fi 2s forwards; font-weight:600;">Evade</h1>
                    <h3 style="margin:0 0 16px; font-weight:400; font-size:14px; opacity:0.8;">by <a href="https://skipped.lol/" target="_blank" style="color:#4c82af; text-decoration:none;">skipped.lol</a></h3>
                    <p id="evade-status" class="evade-status">Bypassing your link...</p>
                </div>
            </div>
        `;
        
        document.body.appendChild(overlayDiv);
        bypassStartTime = Date.now();
    }

    function updateStatus(msg) {
        const statusEl = document.getElementById("evade-status");
        if (statusEl) {
            statusEl.textContent = msg;
            statusEl.style.color = "#4caf9e";
        }
    }

    function showDestinationButton(url) {
        const statusEl = document.getElementById("evade-status");
        if (statusEl) {
            const newTabTarget = getSettings().openNewTab ? "_blank" : "_self";
            
            statusEl.innerHTML = `
                <span style="display:block; margin-bottom:15px; color:#4caf9e;">Bypass complete!</span>
                <a id="evade-destination-btn" href="${url}" target="${newTabTarget}" rel="noopener" style="
                    display: inline-block;
                    background: linear-gradient(135deg, #4c82af 0%, #3a6a8f 100%);
                    color: white;
                    text-decoration: none;
                    border: none;
                    padding: 14px 32px;
                    font-size: 16px;
                    font-weight: 600;
                    border-radius: 8px;
                    cursor: pointer;
                    font-family: 'Poppins', sans-serif;
                    box-shadow: 0 4px 15px rgba(76, 130, 175, 0.4);
                    transition: transform 0.2s, box-shadow 0.2s;
                    position: relative;
                    z-index: 9999;
                ">Open Destination</a>
            `;

            const btn = document.getElementById("evade-destination-btn");
            
            originalAddEventListener.call(btn, "click", (e) => {
                e.stopImmediatePropagation();
                if (newTabTarget === "_blank") {
                    window.open(url, "_blank", "noopener");
                } else {
                    window.location.href = url;
                }
            }, true);

            originalAddEventListener.call(btn, "mouseenter", () => {
                btn.style.transform = "scale(1.05)";
                btn.style.boxShadow = "0 6px 20px rgba(76, 130, 175, 0.5)";
            });

            originalAddEventListener.call(btn, "mouseleave", () => {
                btn.style.transform = "scale(1)";
                btn.style.boxShadow = "0 4px 15px rgba(76, 130, 175, 0.4)";
            });
        }
    }

    function showCopyButton(textToCopy) {
        const statusEl = document.getElementById("evade-status");
        if (!statusEl) return;

        statusEl.innerHTML = `
            <span style="display:block; margin-bottom:15px; color:#4caf9e;">Bypass complete!</span>
            <button id="evade-copy-btn" style="
                display: inline-block;
                background: linear-gradient(135deg, #4c82af 0%, #3a6a8f 100%);
                color: white;
                border: none;
                padding: 14px 32px;
                font-size: 16px;
                font-weight: 600;
                border-radius: 8px;
                cursor: pointer;
                font-family: 'Poppins', sans-serif;
                box-shadow: 0 4px 15px rgba(76, 130, 175, 0.4);
                transition: transform 0.2s, box-shadow 0.2s;
                position: relative;
                z-index: 9999;
            ">Copy to Clipboard</button>
        `;

        const btn = document.getElementById("evade-copy-btn");

        originalAddEventListener.call(btn, "click", (e) => {
            e.stopImmediatePropagation();
            navigator.clipboard.writeText(textToCopy).then(() => {
                btn.textContent = "Copied!";
                setTimeout(() => { btn.textContent = "Copy to Clipboard"; }, 2000);
            }).catch(() => {
                btn.textContent = "Copy failed";
                setTimeout(() => { 
                    btn.textContent = "Copy to Clipboard"; 
                    btn.style.background = "linear-gradient(135deg, #4c82af 0%, #3a6a8f 100%)";
                }, 2000);
            });
        }, true);

        originalAddEventListener.call(btn, "mouseenter", () => {
            btn.style.transform = "scale(1.05)";
            btn.style.boxShadow = "0 6px 20px rgba(76, 130, 175, 0.5)";
        });

        originalAddEventListener.call(btn, "mouseleave", () => {
            btn.style.transform = "scale(1)";
            btn.style.boxShadow = "0 4px 15px rgba(76, 130, 175, 0.4)";
        });
    }

    // Work.ink Initialization
    async function initWorkInk() {
        let monocleValue = null;

        if (serviceType === "workink") {
            createUIOverlay();
            updateStatus("If you get stuck here, you're potentially trying to bypass using a VPN/Proxy and work.ink probably blocked your connection!");

            monocleValue = await (async function () {
                return new Promise((resolve) => {
                    const timer = setInterval(() => {
                        const input = document.querySelector('form.monocle-enriched input[name="monocle"]');
                        if (input && input.value && input.value.length > 0) {
                            clearInterval(timer);
                            resolve(input.value);
                        }
                    }, 200);
                });
            })();

            try {
                authData = await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: "POST",
                        url: INIT_API,
                        headers: { "Content-Type": "application/json" },
                        data: JSON.stringify({ mcl: monocleValue, session_id: sessionId }),
                        onload: (resp) => {
                            try { resolve(JSON.parse(resp.responseText)); } catch (err) { reject(err); }
                        },
                        onerror: reject,
                        timeout: 10000
                    });
                });
            } catch (e) {}
        }

        clearPage();
        await sleep(1000);
        clearPage();
        createUIOverlay();

        if (serviceType === "workink") {
            (function hijackEvents() {
                const origPreventDefault = Event.prototype.preventDefault;
                Event.prototype.preventDefault = function () {
                    if (!this.target?.closest?.("#evade-overlay") && !this.target?.closest?.("#evade-settings-modal")) {
                        return origPreventDefault.call(this);
                    }
                };

                const origStopProp = Event.prototype.stopPropagation;
                const origStopImmProp = Event.prototype.stopImmediatePropagation;

                Event.prototype.stopPropagation = function () {
                    if (!this.target?.closest?.("#evade-overlay") && !this.target?.closest?.("#evade-settings-modal")) {
                        return origStopProp.call(this);
                    }
                };

                Event.prototype.stopImmediatePropagation = function () {
                    if (!this.target?.closest?.("#evade-overlay") && !this.target?.closest?.("#evade-settings-modal")) {
                        return origStopImmProp.call(this);
                    }
                };

                setInterval(() => {
                    document.querySelectorAll('[class*="fc-"]').forEach(el => el.remove());
                }, 200);
            })();
        }

        updateStatus("Checking for updates...");
        if (await checkUpdates()) {
            await (async function (mclParam) {
                updateStatus("Fetching page data...");
                try {
                    const responseText = await (await fetch(currentUrl)).text();
                    updateStatus("Extracting link parameters...");

                    const userIdMatch = responseText.match(/f_user_id\s*:\s*["']?(\d+)["']?/);
                    if (!userIdMatch?.[1]) {
                        updateStatus("Failed to extract user ID. Please refresh.");
                        return;
                    }

                    const extractedUserId = userIdMatch[1];
                    const pathSegments = new URL(currentUrl).pathname.split("/").filter(Boolean);
                    const customId = pathSegments[1] || pathSegments[0] || "";
                    const srParam = new URLSearchParams(new URL(currentUrl).search).get("sr") || "";

                    updateStatus("Connecting to work.ink...");
                    connectWorkInkWS(extractedUserId, customId, srParam, mclParam);

                } catch (e) {
                    updateStatus("Failed to initialize. Please refresh.");
                }
            })(monocleValue);
        }
    }

    function injectTurnstileResponse(form) {
        if (!form) return;
        let responseInput = form.querySelector('input[name="cf-turnstile-response"]');
        if (responseInput && responseInput.value && responseInput.value.length > 0) return;

        const allTurnstileInputs = document.querySelectorAll('input[name="cf-turnstile-response"]');
        let validToken = "";

        for (const input of allTurnstileInputs) {
            if (input.value && input.value.length > 0) {
                validToken = input.value;
                break;
            }
        }

        if (validToken) {
            if (responseInput) {
                responseInput.value = validToken;
            } else {
                const hiddenInput = document.createElement("input");
                hiddenInput.type = "hidden";
                hiddenInput.name = "cf-turnstile-response";
                hiddenInput.value = validToken;
                form.appendChild(hiddenInput);
            }
        }
    }

    function handleTurnstile() {
        const styleEl = document.createElement("style");
        styleEl.id = "evade-turnstile-overlay";
        styleEl.textContent = `
            .cf-turnstile, [data-turnstile] {
                position: fixed !important;
                z-index: 10000000 !important;
                bottom: auto !important;
                left: 50% !important;
                top: 65% !important;
                right: auto !important;
                transform: translateX(-50%) !important;
                visibility: visible !important;
                opacity: 1 !important;
                pointer-events: auto !important;
            }
            iframe[src*="challenges.cloudflare.com"] {
                visibility: visible !important;
                opacity: 1 !important;
                pointer-events: auto !important;
            }
        `;
        document.head.appendChild(styleEl);

        const checkInterval = setInterval(() => {
            const turnstileEl = document.querySelector(".cf-turnstile, [data-turnstile]");
            const turnstileInput = document.querySelector('input[name="cf-turnstile-response"]');
            const hintEl = document.getElementById("evade-turnstile-hint");

            if (turnstileInput && turnstileInput.value && turnstileInput.value.length > 0) {
                if (hintEl) hintEl.remove();
                clearInterval(checkInterval);
                return;
            }

            if (turnstileEl && !hintEl) {
                const statusEl = document.getElementById("evade-status");
                if (statusEl && statusEl.parentElement) {
                    const hintPara = document.createElement("p");
                    hintPara.id = "evade-turnstile-hint";
                    hintPara.style.cssText = "font-size:13px; color:#ff9800; margin-top:12px; opacity:0.9;";
                    hintPara.textContent = "Complete the captcha below to continue.";
                    statusEl.parentElement.appendChild(hintPara);
                }
            }
        }, 500);
    }

    async function initLootLabs() {
        const injectScriptP = document.createElement("script");
        injectScriptP.textContent = "document.documentElement.setAttribute('data-ll-p', JSON.stringify(p));";
        document.documentElement.appendChild(injectScriptP);
        injectScriptP.remove();

        const pData = JSON.parse(document.documentElement.getAttribute("data-ll-p"));

        await new Promise((resolve) => {
            let attempt = 0;
            const botdInterval = setInterval(() => {
                const botdScript = document.createElement("script");
                botdScript.textContent = "document.documentElement.setAttribute('data-ll-botd-ready', document.botd ? '1' : '0');";
                document.documentElement.appendChild(botdScript);
                botdScript.remove();

                if (document.documentElement.getAttribute("data-ll-botd-ready") === "1" || attempt++ > 50) {
                    clearInterval(botdInterval);
                    const botdSaveScript = document.createElement("script");
                    botdSaveScript.textContent = `
                        document.documentElement.setAttribute('data-ll-botd', JSON.stringify(document.botd || null));
                        document.documentElement.setAttribute('data-ll-botds', document.session || '');
                    `;
                    document.documentElement.appendChild(botdSaveScript);
                    botdSaveScript.remove();
                    resolve();
                }
            }, 200);
        });

        if (document.documentElement.getAttribute("data-ll-botds")) {
            const beaconScript = document.createElement("script");
            beaconScript.textContent = "navigator.sendBeacon('/verify', JSON.stringify({ session: document.session }));";
            document.documentElement.appendChild(beaconScript);
            beaconScript.remove();
        }

        clearPage();
        createUIOverlay();
        updateStatus("Checking for updates...");
        
        if (!(await checkUpdates())) return;

        updateStatus("Processing your link...");
        let fetchReq = await fetch("//" + pData.CDN_DOMAIN + "/?tid=" + pData.TID + "&params_only=1");
        let fetchText = "[" + (await fetchReq.text()).slice(1, -2) + "]";
        let parsedText = JSON.parse(fetchText);

        let endpointUrl = "https://" + parsedText[29] + "/tc";
        let sessionRand = String(Math.floor(9 * Math.random() + 1) + Array(16).fill().map(() => Math.floor(10 * Math.random())).join("") + Math.floor(10 * Math.random()));
        
        let llCookieId = localStorage.getItem("ll_cookie_id");
        if (!llCookieId) {
            llCookieId = String(Math.floor(9e8 * Math.random()) + 1e8);
            localStorage.setItem("ll_cookie_id", llCookieId);
        }

        let taboolaSync = "";
        try {
            const taboolaItem = localStorage.getItem("taboola_user_sync");
            if (taboolaItem) {
                const parsedTaboola = JSON.parse(taboolaItem);
                if (parsedTaboola.expiry && (new Date).getTime() <= parsedTaboola.expiry) {
                    taboolaSync = parsedTaboola.value;
                }
            }
        } catch (e) {}

        let requestBody = {
            tid: pData.TID,
            bl: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53],
            session: sessionRand,
            max_tasks: 1,
            design_id: 106,
            cur_url: window.location.href,
            doc_ref: document.referrer,
            tier_id: pData.TIER_ID,
            num_of_tasks: pData.NUM_OF_TASKS,
            is_loot: true,
            rkey: pData.KEY,
            cookie_id: llCookieId,
            offer: pData.OFFER || "0"
        };

        const botdAttr = document.documentElement.getAttribute("data-ll-botd");
        if (botdAttr && botdAttr !== "null") requestBody.botd = botdAttr;

        const botdsAttr = document.documentElement.getAttribute("data-ll-botds");
        if (botdsAttr) requestBody.botds = botdsAttr;

        requestBody.taboola_user_sync = taboolaSync;

        const puidParam = new URLSearchParams(window.location.search).get("puid");
        if (puidParam) requestBody.puid = puidParam;

        const stringifiedBody = JSON.stringify(requestBody);

        const fetchRunnerScript = document.createElement("script");
        fetchRunnerScript.textContent = `
            (async () => {
                try {
                    window.__ll_allow_tc = true;
                    const resp = await fetch(${JSON.stringify(endpointUrl)}, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        mode: 'cors',
                        redirect: 'follow',
                        body: ${JSON.stringify(stringifiedBody)}
                    });
                    const text = await resp.text();
                    document.documentElement.setAttribute('data-ll-tc-status', String(resp.status));
                    document.documentElement.setAttribute('data-ll-tc-response', text);
                } catch(e) {
                    document.documentElement.setAttribute('data-ll-tc-status', 'error');
                    document.documentElement.setAttribute('data-ll-tc-response', e.message);
                }
            })();
        `;
        document.documentElement.appendChild(fetchRunnerScript);
        fetchRunnerScript.remove();

        const fetchResponse = await new Promise((resolve) => {
            const checkTcInterval = setInterval(() => {
                const status = document.documentElement.getAttribute("data-ll-tc-status");
                if (status) {
                    clearInterval(checkTcInterval);
                    resolve({
                        status: status,
                        response: document.documentElement.getAttribute("data-ll-tc-response")
                    });
                }
            }, 100);
        });

        const resetAndReload = async (msg) => {
            localStorage.clear();
            sessionStorage.clear();
            document.cookie.split(";").forEach((c) => {
                const cookieName = c.split("=")[0].trim();
                document.cookie = cookieName + "=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;";
                document.cookie = cookieName + "=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;domain=" + location.hostname + ";";
                document.cookie = cookieName + "=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;domain=." + location.hostname + ";";
            });
            updateStatus(msg + ", refreshing...");
            await sleep(1500);
            window.location.reload();
        };

        if (fetchResponse.status !== "200") {
            return await resetAndReload("Request failed (" + fetchResponse.status + ")");
        }

        let tasksData;
        try {
            tasksData = JSON.parse(fetchResponse.response);
        } catch (e) {
            return await resetAndReload("Invalid response");
        }

        if (!tasksData.length) {
            return await resetAndReload("No tasks available");
        }

        const urids = tasksData.map((e => e.urid));
        const taskIds = tasksData.map((e => e.task_id));
        const firstUrid = tasksData[0].urid.toString();
        const serverPrefix = Number(firstUrid.substr(-5)) % 3;
        const mainDomain = parsedText[9];
        const serverUrl = "https://" + serverPrefix + "." + mainDomain;
        const fallbackDomain = parsedText[29];
        const sessionToUse = tasksData[0].session_id || sessionRand;

        for (let i = 0; i < tasksData.length; i++) {
            const task = tasksData[i];
            
            if (task.task_id == 17) {
                setTimeout(() => {
                    GM_xmlhttpRequest({
                        method: "POST",
                        url: "https://skipped.lol/api/evade/ll",
                        headers: { "Content-Type": "application/json" },
                        data: JSON.stringify({ ID: 17, URL: task.ad_url }),
                        onerror: () => updateStatus("Backend request failed. Please refresh."),
                        ontimeout: () => updateStatus("Backend request timed out. Please refresh."),
                        onload: () => {}
                    });
                }, 4000);
            }

            const beaconUrl = "https://enaightdecipie.com?event=task_clicked&session_id=" + sessionToUse + "&info=" + (i + 1);
            try {
                const s = document.createElement("script");
                s.textContent = `navigator.sendBeacon(${JSON.stringify(beaconUrl)});`;
                document.documentElement.appendChild(s);
                s.remove();
            } catch (e) {}

            const stUrl = serverUrl + "/st?uid=" + task.urid + "&cat=" + task.task_id;
            try {
                const s = document.createElement("script");
                s.textContent = `navigator.sendBeacon(${JSON.stringify(stUrl)});`;
                document.documentElement.appendChild(s);
                s.remove();
            } catch (e) {}

            if (task.action_pixel_url) {
                try {
                    const s = document.createElement("script");
                    s.textContent = `fetch(${JSON.stringify("//" + task.action_pixel_url.replace(/^\/\//, ""))}, { method: 'GET', redirect: 'follow', credentials: 'include', mode: 'cors' }).then(function(r){ return r.text(); });`;
                    document.documentElement.appendChild(s);
                    s.remove();
                } catch (e) {}
            }
        }

        updateStatus("Waiting for completion, this can take upto 2 minutes...");

        for (let i = 0; i < tasksData.length; i++) {
            const task = tasksData[i];
            if (task.auto_complete_seconds !== undefined) {
                const acTime = task.auto_complete_seconds;
                const pUrl = serverUrl + "/p?uid=" + task.urid;
                setTimeout(() => {
                    const s = document.createElement("script");
                    s.textContent = `navigator.sendBeacon(${JSON.stringify(pUrl)});`;
                    document.documentElement.appendChild(s);
                    s.remove();
                }, acTime * 1000);
            }
        }

        const wsEndpoint = "wss://" + serverPrefix + "." + mainDomain + "/c?uid=" + urids.join(",") + "&cat=" + taskIds.join(",") + "&key=" + pData.KEY + "&session_id=" + sessionToUse + "&is_loot=1&tid=" + pData.TID;

        function xorDecode(encodedStr, offset = 5) {
            const decodedB64 = atob(encodedStr);
            const keyPart = decodedB64.substring(0, offset);
            const dataPart = decodedB64.substring(offset);
            let result = "";
            for (let i = 0; i < dataPart.length; i++) {
                result += String.fromCharCode(dataPart.charCodeAt(i) ^ keyPart.charCodeAt(i % keyPart.length));
            }
            return result;
        }

        let pendingResult = null;
        const wsScript = document.createElement("script");
        wsScript.textContent = `
            (function() {
                var ws = new WebSocket(${JSON.stringify(wsEndpoint)});
                ws.onopen = function() {
                    setTimeout(function() {
                        ws.send('0');
                        setInterval(function() { ws.send('0'); }, 10000);
                    }, 10000);
                };
                ws.onmessage = function(e) {
                    document.documentElement.setAttribute('data-ll-ws-msg', e.data);
                    document.documentElement.dispatchEvent(new CustomEvent('ll-ws-msg'));
                };
                ws.onerror = function(e) { };
                ws.onclose = function(e) { };
            })();
        `;
        document.documentElement.appendChild(wsScript);
        wsScript.remove();

        const completedSet = new Set();
        document.documentElement.addEventListener("ll-ws-msg", () => {
            const wsMsg = document.documentElement.getAttribute("data-ll-ws-msg");
            if (!wsMsg) return;

            if (wsMsg.includes("r:")) {
                pendingResult = wsMsg.replace("r:", "");
                if (completedSet.size >= tasksData.length || (tasksData[0].test_choose === 1 && completedSet.size >= 2)) {
                    showDestinationButton(xorDecode(pendingResult));
                    return;
                }
            }

            if (wsMsg === "Refresh Page") {
                window.location.reload();
                return;
            }

            const parts = wsMsg.split(",");
            if (parts.length >= 2) {
                const urid = parts[0];
                const cat = parts[1];
                const type = parts[2];

                completedSet.add(urid);

                const tdUrl = "https://" + fallbackDomain + "/td?ac=" + (type || "auto_complete") + "&urid=" + urid + "&&cat=" + cat + "&tid=" + pData.TID;
                try {
                    const s = document.createElement("script");
                    s.textContent = `fetch(${JSON.stringify(tdUrl)}, { method: 'GET', redirect: 'follow', credentials: 'include', mode: 'cors' }).then(function(r){ return r.text(); });`;
                    document.documentElement.appendChild(s);
                    s.remove();
                } catch (e) {}

                if ((completedSet.size >= tasksData.length || (tasksData[0].test_choose === 1 && completedSet.size >= 2)) && pendingResult) {
                    showDestinationButton(xorDecode(pendingResult));
                }
            }
        });
    }

    // Register Menu Commands
    GM_registerMenuCommand("Evade Settings", () => {
        const existingModal = document.getElementById("evade-settings-modal");
        if (existingModal) existingModal.remove();

        const currentSettings = getSettings();
        const modalDiv = document.createElement("div");
        modalDiv.id = "evade-settings-modal";
        modalDiv.innerHTML = `
            <style>
                #evade-settings-modal input[type="range"] { -webkit-appearance:none; appearance:none; width:100%; height:6px; background:#333; border-radius:3px; outline:none; }
                #evade-settings-modal input[type="range"]::-webkit-slider-thumb { -webkit-appearance:none; appearance:none; width:18px; height:18px; background:#4c82af; border-radius:50%; cursor:pointer; }
                #evade-settings-modal input[type="range"]::-moz-range-thumb { width:18px; height:18px; background:#4c82af; border-radius:50%; cursor:pointer; border:none; }
                #evade-settings-modal input[type="checkbox"] { -webkit-appearance:none; appearance:none; width:18px; height:18px; background:#333; border:2px solid #555; border-radius:4px; cursor:pointer; position:relative; }
                #evade-settings-modal input[type="checkbox"]:checked { background:#4c82af; border-color:#4c82af; }
                #evade-settings-modal input[type="checkbox"]:checked::after { content:'✓'; position:absolute; color:white; font-size:12px; top:50%; left:50%; transform:translate(-50%, -50%); }
            </style>
            <div style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:9999999;display:flex;justify-content:center;align-items:center;font-family:'Poppins',sans-serif;">
                <div style="background:#1a1a1a;border-radius:12px;padding:30px;min-width:350px;box-shadow:0 10px 40px rgba(0,0,0,0.5);border:1px solid #333;">
                    <h2 style="color:#fff;margin:0 0 25px;font-size:24px;text-align:center;">Evade Settings</h2>
                    <div style="margin-bottom:25px;">
                        <label style="color:#ccc;font-size:14px;display:block;margin-bottom:10px;">
                            Minimum Time: <span id="evade-delay-value" style="color:#4c82af;font-weight:bold;">${currentSettings.minimumTime}s</span>
                        </label>
                        <input type="range" id="evade-delay-slider" min="0" max="120" value="${currentSettings.minimumTime}">
                        <p style="color:#888;font-size:12px;margin-top:10px;">Minimum time before showing the destination button. Evade will wait until this time has passed.</p>
                    </div>
                    <div style="margin-bottom:25px;">
                        <label style="color:#ccc;font-size:14px;display:flex;align-items:center;gap:12px;cursor:pointer;">
                            <input type="checkbox" id="evade-aurora-toggle" ${currentSettings.auroraBackground ? "checked" : ""}>
                            Aurora Background
                        </label>
                    </div>
                    <div style="margin-bottom:25px;">
                        <label style="color:#ccc;font-size:14px;display:flex;align-items:center;gap:12px;cursor:pointer;">
                            <input type="checkbox" id="evade-newtab-toggle" ${currentSettings.openNewTab ? "checked" : ""}>
                            Open destination in new tab
                        </label>
                        <p style="color:#888;font-size:12px;margin-top:10px;">It's recommended to leave this on but could make some key-systems fail. Turn off in the event of failures.</p>
                    </div>
                    <div style="display:flex;gap:10px;justify-content:flex-end;">
                        <button id="evade-settings-cancel" style="background:#333;color:#fff;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;">Cancel</button>
                        <button id="evade-settings-save" style="background:#4c7aaf;color:#fff;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;font-weight:bold;">Save</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modalDiv);

        const slider = document.getElementById("evade-delay-slider");
        const sliderValue = document.getElementById("evade-delay-value");

        slider.oninput = () => {
            sliderValue.textContent = slider.value + "s";
        };

        document.getElementById("evade-settings-cancel").onclick = () => {
            modalDiv.remove();
        };

        document.getElementById("evade-settings-save").onclick = () => {
            GM_setValue("minimumTime", parseInt(slider.value));
            GM_setValue("auroraBackground", document.getElementById("evade-aurora-toggle").checked);
            GM_setValue("openNewTab", document.getElementById("evade-newtab-toggle").checked);
            modalDiv.remove();
        };

        modalDiv.onclick = (e) => {
            if (e.target === modalDiv) modalDiv.remove();
        };
    });

    // Main Router
    const { hostname: hostName, pathname: pathName } = location;

    if (serviceType === "workink") {
        if ((hostName === "work.ink" && (pathName === "/" || pathName === "")) || hostName === "paste.work.ink" || pathName.startsWith("/token/") || hostName === "outgoing.work.ink") {
            return;
        }

        (function () {
            const checkReady = setInterval(() => {
                if (!document.title.includes("403") && !document.title.includes("404") && !document.body?.textContent?.includes("You are not a robot, right?")) {
                    clearInterval(checkReady);
                    if (document.readyState === "loading") {
                        document.addEventListener("DOMContentLoaded", initWorkInk);
                    } else {
                        initWorkInk();
                    }
                }
            }, 500);
        })();

    } else if (serviceType === "lootlabs") {
        if (!((hostName !== "lootdest.org" && hostName !== "loot-links.com" && hostName !== "loot-link.com") || (pathName !== "/" && pathName !== ""))) {
            return;
        }

        const scriptEl = document.createElement("script");
        scriptEl.textContent = `
            (function() {
                var origFetch = window.fetch;
                window.__ll_allow_tc = false;
                window.fetch = function() {
                    var url = typeof arguments[0] === 'string' ? arguments[0] : (arguments[0] && arguments[0].url);
                    if (url && url.indexOf('/tc') !== -1 && arguments[1] && arguments[1].method === 'POST' && !window.__ll_allow_tc) {
                        return new Promise(function() {});
                    }
                    return origFetch.apply(this, arguments);
                };
            })();
        `;
        document.documentElement.appendChild(scriptEl);
        scriptEl.remove();

        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", initLootLabs);
        } else {
            initLootLabs();
        }

    } else if (serviceType === "linkvertise") {
        if (pathName === "/" || pathName === "") return;

        (async function () {
            clearPage();
            await sleep(1000);
            clearPage();
            createUIOverlay();
            updateStatus("Checking for updates...");

            if (!(await checkUpdates())) return;

            updateStatus("Starting bypass...");
            let hashParam = "";
            let linkUrl = unsafeWindow.location.href;

            if (linkUrl.includes("/dynamic")) {
                const dynUrlParams = new URL(linkUrl).searchParams.get("r");
                if (dynUrlParams) {
                    hashParam = decodeURIComponent(dynUrlParams);
                }
                linkUrl = linkUrl.replace(/[?&]o=sharing/g, "");
            }

            setTimeout(() => {
                GM_xmlhttpRequest({
                    method: "POST",
                    url: "https://skipped.lol/api/evade/lv",
                    headers: { "Content-Type": "application/json" },
                    data: JSON.stringify({ URL: linkUrl, userAndHash: hashParam }),
                    onerror: () => updateStatus("Backend request failed. Please refresh."),
                    ontimeout: () => updateStatus("Backend request timed out. Please refresh."),
                    onload: (resp) => {
                        updateStatus("Processing Linkvertise link, this can take upto 30 seconds...");
                        const parsed = JSON.parse(resp.responseText);

                        if (parsed) {
                            updateStatus("Link bypassed! Getting it ready...");
                            if (parsed.type === "paste") {
                                isBypassed = true;
                                showCopyButton(parsed.resp);
                                return;
                            }
                            if (parsed.type === "url") {
                                isBypassed = true;
                                (function (destinationUrl) {
                                    const statusEl = document.getElementById("evade-status");
                                    if (!statusEl) return;

                                    const newTabTarget = getSettings().openNewTab ? "_blank" : "_self";
                                    let isExpired = false;

                                    statusEl.innerHTML = `
                                        <span style="display:block; margin-bottom:8px; color:#4caf9e;">Bypass complete!</span>
                                        <span id="evade-timer-text" style="display:block; margin-bottom:15px; color:#ff5252; font-size:13px;">Link expires in 9s</span>
                                        <a id="evade-destination-btn" href="${destinationUrl}" target="${newTabTarget}" rel="noopener" style="
                                            display: inline-block;
                                            background: linear-gradient(135deg, #4c82af 0%, #3a6a8f 100%);
                                            color: white;
                                            text-decoration: none;
                                            border: none;
                                            padding: 14px 32px;
                                            font-size: 16px;
                                            font-weight: 600;
                                            border-radius: 8px;
                                            cursor: pointer;
                                            font-family: 'Poppins', sans-serif;
                                            box-shadow: 0 4px 15px rgba(76, 130, 175, 0.4);
                                            transition: transform 0.2s, box-shadow 0.2s;
                                            position: relative;
                                            z-index: 9999;
                                        ">Open Destination</a>
                                    `;

                                    const btn = document.getElementById("evade-destination-btn");
                                    const timerText = document.getElementById("evade-timer-text");

                                    const invalidateBtn = () => {
                                        if (!isExpired) {
                                            isExpired = true;
                                            clearInterval(countdownInterval);
                                            statusEl.innerHTML = '<span style="display:block; color:#ff5252; font-size:16px;">This hash has already been used! Refresh the page to bypass the link again.</span>';
                                            statusEl.style.color = "#ff5252";
                                        }
                                        return true;
                                    };

                                    originalAddEventListener.call(btn, "click", (e) => {
                                        if (isExpired) {
                                            e.preventDefault();
                                        } else {
                                            e.preventDefault();
                                            e.stopImmediatePropagation();
                                            invalidateBtn();
                                            if (newTabTarget === "_blank") {
                                                window.open(destinationUrl, "_blank", "noopener");
                                            } else {
                                                window.location.href = destinationUrl;
                                            }
                                        }
                                    }, true);

                                    originalAddEventListener.call(btn, "auxclick", (e) => {
                                        if (e.button === 1) {
                                            if (isExpired) return void e.preventDefault();
                                            invalidateBtn();
                                        }
                                    }, true);

                                    originalAddEventListener.call(btn, "mouseenter", () => {
                                        if (!isExpired) {
                                            btn.style.transform = "scale(1.05)";
                                            btn.style.boxShadow = "0 6px 20px rgba(76, 130, 175, 0.5)";
                                        }
                                    });

                                    originalAddEventListener.call(btn, "mouseleave", () => {
                                        btn.style.transform = "scale(1)";
                                        btn.style.boxShadow = "0 4px 15px rgba(76, 130, 175, 0.4)";
                                    });

                                    let secondsLeft = 9;
                                    const countdownInterval = setInterval(() => {
                                        secondsLeft = Math.round(10 * (secondsLeft - 1)) / 10;
                                        if (timerText) timerText.textContent = `Link expires in ${secondsLeft}s`;
                                        if (secondsLeft <= 0) {
                                            clearInterval(countdownInterval);
                                            isExpired = true;
                                            statusEl.innerHTML = '<span style="display:block; color:#ff5252; font-size:16px;">Your hash expired. Please refresh the page and bypass your link again.</span>';
                                            statusEl.style.color = "#ff5252";
                                        }
                                    }, 1000);
                                })(parsed.resp);
                            }
                        } else {
                            updateStatus("Backend failed to respond, retrying...");
                        }
                    }
                });
            }, 1000);

            setInterval(() => {
                document.querySelectorAll('[class*="fc-"]').forEach(el => el.remove());
            }, 200);

        })();

    } else if (serviceType === "cuty") {
        if (pathName === "/" || pathName === "") return;

        const initCuty = async () => {
            createUIOverlay();
            handleTurnstile();
            updateStatus("Checking for updates...");

            if (!(await checkUpdates())) return;
            updateStatus("Bypass is running, please be patient...");

            const waitInterval = setInterval(() => {
                const submitForm = document.getElementById("submit-form");
                const dataInput = document.querySelector('input[name="data"]');

                if (submitForm && dataInput) {
                    clearInterval(waitInterval);
                    setTimeout(() => submitForm.submit(), 10000);
                    return;
                }

                const freeSubmitForm = document.getElementById("free-submit-form");
                const submitBtn = document.getElementById("submit-button");
                const tokenInput = document.querySelector('input[name="_token"]');
                const turnstileInput = document.querySelector('input[name="cf-turnstile-response"]');

                if (freeSubmitForm && submitBtn && tokenInput) {
                    if (turnstileInput) {
                        if (turnstileInput.value && turnstileInput.value.length > 0) {
                            clearInterval(waitInterval);
                            injectTurnstileResponse(freeSubmitForm);
                            freeSubmitForm.submit();
                        }
                        return;
                    }

                    clearInterval(waitInterval);
                    injectTurnstileResponse(freeSubmitForm);
                    freeSubmitForm.submit();
                }
            }, 500);
        };

        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", initCuty);
        } else {
            initCuty();
        }

    } else if (serviceType === "shortfly") {
        if (pathName === "/" || pathName === "") return;

        const initShortfly = async () => {
            createUIOverlay();
            handleTurnstile();
            updateStatus("Checking for updates...");

            if (!(await checkUpdates())) return;

            const stepType = hostName.includes("shrtslug.biz") ? 1 :
                hostName.includes("biovetro.net") ? 2 :
                hostName.includes("technons.com") ? 3 :
                hostName.includes("yrtourguide.com") || hostName.includes("tournguide.com") ? 4 : 1;

            updateStatus(`Starting bypass (step ${stepType})...`);

            const bypassInterval = setInterval(async () => {
                const startBtn = document.querySelector('button[id$="_start"]');
                if (startBtn && !startBtn.dataset.evadeClicked) {
                    startBtn.dataset.evadeClicked = "true";
                    updateStatus("Clicking start button...");
                    startBtn.click();
                    await sleep(500);

                    const startArea = document.querySelector('div[id$="_start_area"]');
                    const regularArea = document.querySelector('div[id$="_area"]:not([id$="_start_area"])');

                    if (startArea) startArea.classList.add("hidden");
                    if (regularArea) regularArea.classList.remove("hidden");

                    for (const key of Object.keys(window)) {
                        if (key.startsWith("start_countdown_")) {
                            try { window[key](); } catch (e) {}
                        }
                        if (key.startsWith("start_progressbar_")) {
                            try { window[key](); } catch (e) {}
                        }
                    }
                    updateStatus("Waiting for countdown...");
                }

                if (stepType === 3 || stepType === 4) {
                    const verifyForm = document.querySelector('form[action*="/api-endpoint/verify"]');
                    if (verifyForm && !verifyForm.dataset.evadeSubmitted) {
                        verifyForm.dataset.evadeSubmitted = "true";
                        clearInterval(bypassInterval);

                        updateStatus("Waiting for verification...");
                        await sleep(9000);

                        try {
                            const actionUrl = verifyForm.getAttribute("action");
                            injectTurnstileResponse(verifyForm);
                            const formData = new FormData(verifyForm);

                            const fetchRes = await fetch(actionUrl, { method: "POST", body: formData, credentials: "include" });
                            const jsonRes = await fetchRes.json();

                            if (jsonRes.status === "success") {
                                if (jsonRes.data.final && jsonRes.data.final !== "") {
                                    if (jsonRes.data.final.toLowerCase().startsWith("http")) {
                                        showDestinationButton(jsonRes.data.final);
                                    } else {
                                        showCopyButton(jsonRes.data.final);
                                    }
                                } else if (jsonRes.data.next_page && jsonRes.data.speed_token) {
                                    updateStatus("Redirecting to destination...");
                                    const formEl = document.createElement("form");
                                    formEl.method = "POST";
                                    formEl.action = jsonRes.data.next_page;
                                    formEl.target = "_self";

                                    const tokenInput = document.createElement("input");
                                    tokenInput.type = "hidden";
                                    tokenInput.name = "speed_token";
                                    tokenInput.value = jsonRes.data.speed_token;
                                    
                                    formEl.appendChild(tokenInput);
                                    document.body.appendChild(formEl);
                                    formEl.submit();
                                }
                            } else {
                                updateStatus("Error: " + (jsonRes.data || "Unknown error"));
                            }
                        } catch (e) {
                            updateStatus("Request failed. Please refresh.");
                        }
                        return;
                    }
                    return;
                }

                const normalVerifyForm = document.querySelector('form[action*="/api-endpoint/verify"]');
                if (normalVerifyForm) {
                    const turnstileInput = normalVerifyForm.querySelector('input[name="cf-turnstile-response"]');
                    if (turnstileInput && (!turnstileInput.value || turnstileInput.value.length === 0)) {
                        updateStatus("Waiting for captcha...");
                        return;
                    }

                    clearInterval(bypassInterval);
                    const actionUrl = normalVerifyForm.getAttribute("action");
                    updateStatus(`Sending request #${stepType}...`);

                    try {
                        injectTurnstileResponse(normalVerifyForm);
                        const formData = new FormData(normalVerifyForm);

                        const fetchRes = await fetch(actionUrl, { method: "POST", body: formData, credentials: "include" });
                        const jsonRes = await fetchRes.json();

                        if (jsonRes.status === "success") {
                            if (jsonRes.data.final && jsonRes.data.final !== "") {
                                if (jsonRes.data.final.toLowerCase().startsWith("http")) {
                                    showDestinationButton(jsonRes.data.final);
                                } else {
                                    updateStatus("Processing special link...");
                                    showCopyButton(jsonRes.data.final);
                                }
                            } else if (jsonRes.data.next_page && jsonRes.data.speed_token) {
                                updateStatus(`Proceeding to step ${stepType + 1}...`);
                                const formEl = document.createElement("form");
                                formEl.method = "POST";
                                formEl.action = jsonRes.data.next_page;

                                const tokenInput = document.createElement("input");
                                tokenInput.type = "hidden";
                                tokenInput.name = "speed_token";
                                tokenInput.value = jsonRes.data.speed_token;
                                
                                formEl.appendChild(tokenInput);
                                document.body.appendChild(formEl);
                                formEl.submit();
                            }
                        } else {
                            updateStatus("Error: " + (jsonRes.data || "Unknown error"));
                        }
                    } catch (e) {
                        updateStatus("Request failed. Please refresh.");
                    }
                }
            }, 500);
        };

        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", initShortfly);
        } else {
            initShortfly();
        }

    } else if (serviceType === "rekonise") {
        if (pathName === "/" || pathName === "") return;

        (async function () {
            let stateDataEl;
            const initTimeout = setTimeout(async () => {
                stateDataEl = document.getElementById("ng-state");
                if (stateDataEl) {
                    clearPage();
                    createUIOverlay();
                    updateStatus("Starting bypass, please be patient. This can take upto 10 seconds...");

                    const parsedState = JSON.parse(stateDataEl.textContent);
                    let actionValue, actionType, unlockId, slug = "", token = "";

                    for (const rootKey in parsedState) {
                        for (const childKey in parsedState[rootKey]) {
                            if (childKey === "b") {
                                for (const propKey in parsedState[rootKey][childKey]) {
                                    if (propKey === "actions") {
                                        const actionsObj = parsedState[rootKey][childKey][propKey];
                                        for (const actKey in actionsObj) {
                                            for (const detailKey in actionsObj[actKey]) {
                                                if (detailKey === "value") actionValue = actionsObj[actKey][detailKey];
                                                if (detailKey === "type") actionType = actionsObj[actKey][detailKey];
                                                if (detailKey === "unlockId") unlockId = actionsObj[actKey][detailKey];
                                            }

                                            await (async () => {
                                                GM_xmlhttpRequest({
                                                    method: "POST",
                                                    url: "https://api.rekonise.com/traffic/action-completed",
                                                    headers: { "Content-Type": "application/json" },
                                                    data: JSON.stringify({ actionType: actionType, actionValue: actionValue, slug: slug }),
                                                    onload: (e) => { e.status; }
                                                });
                                            })();
                                        }
                                    }
                                    if (propKey === "slug") slug = parsedState[rootKey][childKey][propKey];
                                    if (propKey === "unlock_token") token = parsedState[rootKey][childKey][propKey];
                                }
                            }
                        }
                    }

                    updateStatus("Waiting for unlock, this can take upto 10 seconds...");
                    await sleep(5000);

                    let attemptCount = 0;
                    const MAX_ATTEMPTS = 10;

                    const tryUnlock = () => {
                        attemptCount++;
                        GM_xmlhttpRequest({
                            method: "GET",
                            url: "https://api.rekonise.com/social-unlocks/" + slug + "/unlock?token=" + token,
                            onload: function (resp) {
                                if (resp.status === 200) {
                                    const parsed = JSON.parse(resp.responseText);
                                    if (parsed.url) return void showDestinationButton(parsed.url);
                                    if (parsed.snippet) return void showCopyButton(parsed.snippet.content);
                                    if (parsed.file) return void showDestinationButton(parsed.file);
                                } else {
                                    if (attemptCount < MAX_ATTEMPTS) {
                                        setTimeout(tryUnlock, 1000);
                                    } else {
                                        updateStatus("Unlock failed. Please refresh and try again.");
                                    }
                                }
                            },
                            onerror: function () {
                                if (attemptCount < MAX_ATTEMPTS) {
                                    setTimeout(tryUnlock, 1000);
                                } else {
                                    updateStatus("Unlock failed. Please refresh and try again.");
                                }
                            }
                        });
                    };

                    tryUnlock();
                    clearInterval(initTimeout);
                }
            }, 1000);
        })();
    }
})();
