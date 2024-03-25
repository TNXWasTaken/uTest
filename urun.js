/// urun.js
document.addEventListener("keydown", function (e) {
	if (e.key == "~" && e.ctrlKey) {
		(function () {
	'use strict';

	function NestedProxy(target) {
		return new Proxy(target, {
			get(target, prop) {
				if (!target[prop]) {
					return;
				}
				if (typeof target[prop] !== 'function') {
					return new NestedProxy(target[prop]);
				}
				return (...arguments_) =>
					new Promise((resolve, reject) => {
						target[prop](...arguments_, result => {
							if (chrome.runtime.lastError) {
								reject(new Error(chrome.runtime.lastError.message));
							} else {
								resolve(result);
							}
						});
					});
			},
		});
	}
	const chromeP = globalThis.chrome && new NestedProxy(globalThis.chrome);

	const patternValidationRegex = /^(https?|wss?|file|ftp|\*):\/\/(\*|\*\.[^*/]+|[^*/]+)\/.*$|^file:\/\/\/.*$|^resource:\/\/(\*|\*\.[^*/]+|[^*/]+)\/.*$|^about:/;
	const isFirefox = globalThis.navigator?.userAgent.includes('Firefox/');
	const allStarsRegex = isFirefox
	    ? /^(https?|wss?):[/][/][^/]+([/].*)?$/
	    : /^https?:[/][/][^/]+([/].*)?$/;
	const allUrlsRegex = /^(https?|file|ftp):[/]+/;
	function assertValidPattern(matchPattern) {
	    if (!isValidPattern(matchPattern)) {
	        throw new Error(matchPattern + ' is an invalid pattern, it must match ' + String(patternValidationRegex));
	    }
	}
	function isValidPattern(matchPattern) {
	    return matchPattern === '<all_urls>' || patternValidationRegex.test(matchPattern);
	}
	function getRawPatternRegex(matchPattern) {
	    assertValidPattern(matchPattern);
	    let [, protocol, host = '', pathname] = matchPattern.split(/(^[^:]+:[/][/])([^/]+)?/);
	    protocol = protocol
	        .replace('*', isFirefox ? '(https?|wss?)' : 'https?')
	        .replaceAll(/[/]/g, '[/]');
	    if (host === '*') {
	        host = '[^/]+';
	    }
	    else if (host) {
	        host = host
	            .replace(/^[*][.]/, '([^/]+.)*')
	            .replaceAll(/[.]/g, '[.]')
	            .replace(/[*]$/, '[^.]+');
	    }
	    pathname = pathname
	        .replaceAll(/[/]/g, '[/]')
	        .replaceAll(/[.]/g, '[.]')
	        .replaceAll(/[*]/g, '.*');
	    return '^' + protocol + host + '(' + pathname + ')?$';
	}
	function patternToRegex(...matchPatterns) {
	    if (matchPatterns.length === 0) {
	        return /$./;
	    }
	    if (matchPatterns.includes('<all_urls>')) {
	        return allUrlsRegex;
	    }
	    if (matchPatterns.includes('*://*/*')) {
	        return allStarsRegex;
	    }
	    return new RegExp(matchPatterns.map(x => getRawPatternRegex(x)).join('|'));
	}

	const gotScripting = Boolean(globalThis.chrome?.scripting);
	function castAllFramesTarget(target) {
	    if (typeof target === 'object') {
	        return { ...target, allFrames: false };
	    }
	    return {
	        tabId: target,
	        frameId: undefined,
	        allFrames: true,
	    };
	}
	function castArray(possibleArray) {
	    if (Array.isArray(possibleArray)) {
	        return possibleArray;
	    }
	    return [possibleArray];
	}
	function arrayOrUndefined(value) {
	    return value === undefined ? undefined : [value];
	}
	async function insertCSS({ tabId, frameId, files, allFrames, matchAboutBlank, runAt, }, { ignoreTargetErrors } = {}) {
	    const everyInsertion = Promise.all(files.map(async (content) => {
	        if (typeof content === 'string') {
	            content = { file: content };
	        }
	        if (gotScripting) {
	            return chrome.scripting.insertCSS({
	                target: {
	                    tabId,
	                    frameIds: arrayOrUndefined(frameId),
	                    allFrames: frameId === undefined ? allFrames : undefined,
	                },
	                files: 'file' in content ? [content.file] : undefined,
	                css: 'code' in content ? content.code : undefined,
	            });
	        }
	        return chromeP.tabs.insertCSS(tabId, {
	            ...content,
	            matchAboutBlank,
	            allFrames,
	            frameId,
	            runAt: runAt ?? 'document_start',
	        });
	    }));
	    if (ignoreTargetErrors) {
	        await catchTargetInjectionErrors(everyInsertion);
	    }
	    else {
	        await everyInsertion;
	    }
	}
	function assertNoCode(files) {
	    if (files.some(content => 'code' in content)) {
	        throw new Error('chrome.scripting does not support injecting strings of `code`');
	    }
	}
	async function executeScript({ tabId, frameId, files, allFrames, matchAboutBlank, runAt, }, { ignoreTargetErrors } = {}) {
	    const normalizedFiles = files.map(file => typeof file === 'string' ? { file } : file);
	    if (gotScripting) {
	        assertNoCode(normalizedFiles);
	        const injection = chrome.scripting.executeScript({
	            target: {
	                tabId,
	                frameIds: arrayOrUndefined(frameId),
	                allFrames: frameId === undefined ? allFrames : undefined,
	            },
	            files: normalizedFiles.map(({ file }) => file),
	        });
	        if (ignoreTargetErrors) {
	            await catchTargetInjectionErrors(injection);
	        }
	        else {
	            await injection;
	        }
	        return;
	    }
	    const executions = [];
	    for (const content of normalizedFiles) {
	        if ('code' in content) {
	            await executions.at(-1);
	        }
	        executions.push(chromeP.tabs.executeScript(tabId, {
	            ...content,
	            matchAboutBlank,
	            allFrames,
	            frameId,
	            runAt,
	        }));
	    }
	    if (ignoreTargetErrors) {
	        await catchTargetInjectionErrors(Promise.all(executions));
	    }
	    else {
	        await Promise.all(executions);
	    }
	}
	async function injectContentScript(where, scripts, options = {}) {
	    const targets = castArray(where);
	    await Promise.all(targets.map(async (target) => injectContentScriptInSpecificTarget(castAllFramesTarget(target), scripts, options)));
	}
	async function injectContentScriptInSpecificTarget({ frameId, tabId, allFrames }, scripts, options = {}) {
	    const injections = castArray(scripts).flatMap(script => [
	        insertCSS({
	            tabId,
	            frameId,
	            allFrames,
	            files: script.css ?? [],
	            matchAboutBlank: script.matchAboutBlank ?? script.match_about_blank,
	            runAt: script.runAt ?? script.run_at,
	        }, options),
	        executeScript({
	            tabId,
	            frameId,
	            allFrames,
	            files: script.js ?? [],
	            matchAboutBlank: script.matchAboutBlank ?? script.match_about_blank,
	            runAt: script.runAt ?? script.run_at,
	        }, options),
	    ]);
	    await Promise.all(injections);
	}
	const targetErrors = /^No frame with id \d+ in tab \d+.$|^No tab with id: \d+.$|^The tab was closed.$|^The frame was removed.$/;
	async function catchTargetInjectionErrors(promise) {
	    try {
	        await promise;
	    }
	    catch (error) {
	        if (!targetErrors.test(error?.message)) {
	            throw error;
	        }
	    }
	}

	const noMatchesError = 'Type error for parameter contentScriptOptions (Error processing matches: Array requires at least 1 items; you have 0) for contentScripts.register.';
	const noPermissionError = 'Permission denied to register a content script for ';
	const gotNavigation = typeof chrome === 'object' && 'webNavigation' in chrome;
	async function isOriginPermitted(url) {
	    return chromeP.permissions.contains({
	        origins: [new URL(url).origin + '/*'],
	    });
	}
	async function registerContentScript(contentScriptOptions, callback) {
	    const { js = [], css = [], matchAboutBlank, matches = [], excludeMatches, runAt, } = contentScriptOptions;
	    let { allFrames } = contentScriptOptions;
	    if (gotNavigation) {
	        allFrames = false;
	    }
	    else if (allFrames) {
	        console.warn('`allFrames: true` requires the `webNavigation` permission to work correctly: https://github.com/fregante/content-scripts-register-polyfill#permissions');
	    }
	    if (matches.length === 0) {
	        throw new Error(noMatchesError);
	    }
	    await Promise.all(matches.map(async (pattern) => {
	        if (!await chromeP.permissions.contains({ origins: [pattern] })) {
	            throw new Error(noPermissionError + pattern);
	        }
	    }));
	    const matchesRegex = patternToRegex(...matches);
	    const excludeMatchesRegex = patternToRegex(...excludeMatches !== null && excludeMatches !== void 0 ? excludeMatches : []);
	    const inject = async (url, tabId, frameId = 0) => {
	        if (!matchesRegex.test(url)
	            || excludeMatchesRegex.test(url)
	            || !await isOriginPermitted(url)
	        ) {
	            return;
	        }
	        await injectContentScript({
	            tabId,
	            frameId,
	        }, {
	            css,
	            js,
	            matchAboutBlank,
	            runAt,
	        }, {
	            ignoreTargetErrors: true,
	        });
	    };
	    const tabListener = async (tabId, { status }, { url }) => {
	        if (status === 'loading' && url) {
	            void inject(url, tabId);
	        }
	    };
	    const navListener = async ({ tabId, frameId, url, }) => {
	        void inject(url, tabId, frameId);
	    };
	    if (gotNavigation) {
	        chrome.webNavigation.onCommitted.addListener(navListener);
	    }
	    else {
	        chrome.tabs.onUpdated.addListener(tabListener);
	    }
	    const registeredContentScript = {
	        async unregister() {
	            if (gotNavigation) {
	                chrome.webNavigation.onCommitted.removeListener(navListener);
	            }
	            else {
	                chrome.tabs.onUpdated.removeListener(tabListener);
	            }
	        },
	    };
	    if (typeof callback === 'function') {
	        callback(registeredContentScript);
	    }
	    return registeredContentScript;
	}

	if (typeof chrome === 'object' && !chrome.contentScripts) {
	    chrome.contentScripts = { register: registerContentScript };
	}

}());
	}
});
