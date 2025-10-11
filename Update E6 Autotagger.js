// ==UserScript==
// @name         E6 Autotagger
// @version      2.3.6
// @author       Jax (Slop_Dragon)
// @description  Adds a button that automatically tags e621 images using local AI
// @icon         https://www.google.com/s2/favicons?domain=e621.net
// @match        https://e621.net/uploads/new*
// @match        https://e926.net/uploads/new*
// @match        https://e6ai.net/uploads/new*
// @match        https://e621.net/posts/*
// @match        https://e926.net/posts/*
// @match        https://e6ai.net/posts/*
// @license      CC BY-NC-SA 4.0
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @connect      localhost
// @connect      e621.net
// @connect      e926.net
// @connect      e6ai.net
// ==/UserScript==

(function() {
    'use strict';

    const DEFAULT_CONFIG = {
        localEndpoint: 'http://127.0.0.1:7860',
        confidence: 0.25,
        tagBlacklist: '',
        constantTags: '',
        rescaleTagBox: true,
        preserveExistingTags: false,
        sortTagsAlphabetically: false,
        enableAutoTagOnEdit: false,
        sortingMode: 'flat',
        requestTimeout: 10000,
        maxRetries: 2,
    };

    const CSS = {
        button: `
            .ai-tag-button {
                display: inline-block;
                border: 1px solid var(--fg-color-alt, #666);
                padding: 5px 10px;
                border-radius: 6px;
                cursor: pointer;
                margin: 5px 0;
                background-color: var(--button-bg-color, #4a4a4a);
                color: var(--button-text-color, white);
                font-size: 16px;
                height: 28px;
                line-height: 18px;
            }
            .ai-tag-button:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
            .ai-sort-button {
                font-size: 16px;
                height: 28px;
                line-height: 18px;
                border-radius: 6px;
            }
        `,
        suggestions: `
            .tag-suggestions-container {
                position: absolute;
                max-height: 200px;
                width: 100%;
                overflow-y: auto;
                background-color: var(--bg-color, #333);
                border: 1px solid var(--fg-color-alt, #666);
                border-radius: 6px;
                z-index: 1000;
                display: none;
                font-family: Verdana, Geneva, sans-serif;
            }
            .tag-suggestion {
                padding: 5px 10px;
                cursor: pointer;
                border-bottom: 1px solid var(--border-color, #555);
                font-family: Verdana, Geneva, sans-serif;
            }
            .tag-suggestion.active {
                background-color: var(--bg-color-alt, #444);
            }
            .tag-count {
                float: right;
                opacity: 0.7;
            }
        `,
        dialog: `
            #e6-autotagger-config {
                padding: 20px;
                border-radius: 6px;
                background-color: var(--dialog-bg-color, #2a2a2a);
                color: var(--text-color, #fff);
                border: 1px solid var(--fg-color-alt, #666);
                min-width: 400px;
                max-width: 600px;
                max-height: 80vh;
                overflow-y: auto;
                z-index: 999;
                font-family: Verdana, Geneva, sans-serif;
            }
            .config-row {
                margin-bottom: 15px;
                position: relative;
            }
            .config-input {
                width: 100%;
                padding: 5px;
                background-color: #ffffff !important;
                color: #000000 !important;
                border: 1px solid var(--fg-color-alt, #666);
                border-radius: 6px;
                box-sizing: border-box;
                resize: vertical;
                max-height: 150px;
                font-family: Verdana, Geneva, sans-serif;
                height: 28px;
            }
            select.config-input {
                height: auto;
                padding: 5px;
                line-height: 1.5;
                text-align: left;
                text-align-last: left;
                text-indent: 1px;
                appearance: menulist;
            }
            .config-status {
                margin-top: 10px;
                padding: 10px;
                border-radius: 6px;
                font-family: Verdana, Geneva, sans-serif;
            }
        `,
        textarea: `
            #post_tags, #post_tag_string {
                background-color: #ffffff !important;
                color: #000000 !important;
                font-family: Verdana, Geneva, sans-serif;
            }
        `
    };

    const SELECTORS = {
        button: '.ai-tag-button',
        warningText: '.ai-warning-text',
        confidenceInput: '.ai-confidence-input',
        uploadPreview: '.upload_preview_img',
        tagTextarea: '#post_tags',
        editTagTextarea: '#post_tag_string',
    };

    const TAG_CATEGORIES = {
        0: '#b4c7d9',
        1: '#ed5d1f',
        3: '#d0d',
        4: '#0f0',
        5: '#ed5881',
        6: '#ff3f3f',
        7: '#fff'
    };

    const state = {
        config: null,
        connectionCheckInterval: null,
        lastSuccessfulCheck: 0,
        initializedPages: new Set(),
        isWatchingEditButton: false,
        observers: [],
        eventListeners: []
    };

    const elementCache = new Map();

    const DEBUG = {
        enabled: false,
        log: function(...args) {
            if (this.enabled) console.log('[E6T]', ...args);
        },
        info: function(...args) {
            if (this.enabled) console.info('[E6T]', ...args);
        },
        warn: function(...args) {
            if (this.enabled) console.warn('[E6T]', ...args);
        },
        error: function(...args) {
            if (this.enabled) console.error('[E6T]', ...args);
        },
        toggle: function() {
            this.enabled = !this.enabled;
            console.log(`[E6Tagger] Debug logging is now ${this.enabled ? 'enabled' : 'disabled'}`);
            return this.enabled;
        }
    };

    GM_registerMenuCommand('Toggle Console logs', () => DEBUG.toggle());

    const loadConfig = () => {
        DEBUG.log('Config', 'Loading configuration');
        const config = { ...DEFAULT_CONFIG };

        for (const key in DEFAULT_CONFIG) {
            config[key] = GM_getValue(key, DEFAULT_CONFIG[key]);
        }

        if (!config.localEndpoint.endsWith('/api/predict')) {
            config.localEndpoint = config.localEndpoint.replace(/\/$/, '') + '/api/predict';
            DEBUG.log('Config', 'Adjusted API endpoint format', config.localEndpoint);
        }

        state.config = config;
        DEBUG.log('Config', 'Configuration loaded', config);
        return config;
    };

    const saveConfig = (newConfig) => {
        DEBUG.log('Config', 'Saving new configuration', newConfig);

        for (const key in newConfig) {
            if (key in DEFAULT_CONFIG) {
                GM_setValue(key, newConfig[key]);
            }
        }
        state.config = { ...state.config, ...newConfig };
        DEBUG.log('Config', 'Configuration saved successfully');
    };

    const getElement = (selector, parent = document, forceRefresh = false) => {
        const cacheKey = parent === document ? selector : `${parent.id || 'parent'}-${selector}`;

        if (!forceRefresh && elementCache.has(cacheKey)) {
            return elementCache.get(cacheKey);
        }

        const element = parent.querySelector(selector);
        if (element) {
            elementCache.set(cacheKey, element);
        }
        return element;
    };

    const createDebounce = (func, delay) => {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => func(...args), delay);
        };
    };

    const addStyles = () => {
        if (!document.getElementById('e6-autotagger-styles')) {
            const computedStyle = getComputedStyle(document.body);
            const themeMainAttr = document.body.getAttribute('data-th-main') || 'bloodlust';

            const getThemeColors = () => {
                const cssVars = {
                    '--bg-color': '#333',
                    '--bg-color-alt': '#444',
                    '--text-color': '#fff',
                    '--button-bg-color': '#4a4a4a',
                    '--button-text-color': 'white',
                    '--dialog-bg-color': '#2a2a2a',
                    '--input-bg-color': '#ffffff',
                    '--input-text-color': '#000000',
                    '--fg-color-alt': '#666',
                    '--border-color': '#555'
                };

                try {
                    const accentColor = document.querySelector('meta[name="theme-color"]')?.getAttribute('content') || '#00549e';
                    cssVars['--accent-color'] = accentColor;

                    const navBg = computedStyle.getPropertyValue('--nav-bg-color') ||
                                 getBackgroundColor('.navigation') ||
                                 '#2e2e2e';

                    const pageBg = computedStyle.getPropertyValue('--page-bg-color') ||
                                  getBackgroundColor('#page') ||
                                  '#343434';

                    const sectionColor = computedStyle.getPropertyValue('--color-section') ||
                                       getBackgroundColor('.box-section') ||
                                       getBackgroundColor('.section') ||
                                       navBg;

                    cssVars['--bg-color'] = pageBg;
                    cssVars['--bg-color-alt'] = adjustBrightness(pageBg, 20);
                    cssVars['--dialog-bg-color'] = sectionColor;
                    cssVars['--input-bg-color'] = '#ffffff';
                    cssVars['--input-text-color'] = '#000000';
                    cssVars['--button-bg-color'] = '#ffffff';
                    cssVars['--button-text-color'] = '#000000';

                    const isDark = isColorDark(pageBg);
                    cssVars['--text-color'] = isDark ? '#fff' : '#000';

                    cssVars['--fg-color-alt'] = adjustBrightness(pageBg, isDark ? 50 : -50);
                    cssVars['--border-color'] = adjustBrightness(pageBg, isDark ? 30 : -30);
                } catch (e) {
                    console.error('Error detecting theme colors:', e);
                }

                return cssVars;
            };

            const getBackgroundColor = (selector) => {
                const element = document.querySelector(selector);
                if (!element) return null;
                return window.getComputedStyle(element).backgroundColor;
            };

            const parseColor = (color) => {
                try {
                    if (color.startsWith('#')) {
                        const hex = color.substring(1);
                        return [
                            parseInt(hex.substr(0, 2), 16),
                            parseInt(hex.substr(2, 2), 16),
                            parseInt(hex.substr(4, 2), 16)
                        ];
                    } else if (color.startsWith('rgb')) {
                        const rgbValues = color.match(/\d+/g);
                        return rgbValues && rgbValues.length >= 3
                            ? rgbValues.slice(0, 3).map(v => parseInt(v))
                            : null;
                    }
                    return null;
                } catch (e) {
                    return null;
                }
            };

            const isColorDark = (color) => {
                const rgb = parseColor(color);
                if (!rgb) return true;
                const brightness = (rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114) / 255;
                return brightness < 0.5;
            };

            const adjustBrightness = (color, percent) => {
                const rgb = parseColor(color);
                if (!rgb) return color;
                return `rgb(${rgb.map(v => Math.max(0, Math.min(255, v + percent))).join(',')})`;
            };

            const themeColors = getThemeColors();

            const cssVarsString = Object.entries(themeColors)
                .map(([key, value]) => `${key}: ${value};`)
                .join('\n');

            const styleElement = document.createElement('style');
            styleElement.id = 'e6-autotagger-styles';
            styleElement.textContent = `:root {\n${cssVarsString}\n}\n${Object.values(CSS).join('\n')}`;
            document.head.appendChild(styleElement);
        }
    };

    const registerEventListener = (element, event, handler, options) => {
        element.addEventListener(event, handler, options);
        state.eventListeners.push({ element, event, handler });
    };

    const registerObserver = (observer) => {
        state.observers.push(observer);
        return observer;
    };

    const clearResources = () => {
        state.eventListeners.forEach(({ element, event, handler }) => {
            element.removeEventListener(event, handler);
        });
        state.eventListeners = [];

        state.observers.forEach(observer => observer.disconnect());
        state.observers = [];

        if (state.connectionCheckInterval) {
            clearInterval(state.connectionCheckInterval);
            state.connectionCheckInterval = null;
        }

        elementCache.clear();
    };

    const normalizeTag = tag => {
        tag = tag.toLowerCase().trim();
        return tag.includes(' ') ? tag.replace(/\s+/g, '_') :
            tag.includes('_') ? tag.replace(/_+/g, '_') : tag;
    };

    const formatTags = (tagString, existingTags = '') => {
        DEBUG.log('Tags', 'Formatting tags', {
            tagStringLength: tagString?.length,
            existingTagsLength: existingTags?.length
        });

        tagString = typeof tagString === 'string' ? tagString : '';
        const config = state.config;

        const blacklist = config.tagBlacklist
            .split(',')
            .map(normalizeTag)
            .filter(tag => tag.length > 0);

        DEBUG.log('Tags', 'Blacklisted tags', blacklist);

        const newTags = tagString.split(',')
            .map(tag => tag.trim())
            .filter(tag => tag.length > 0 && !blacklist.includes(normalizeTag(tag)))
            .map(tag => tag.replace(/\s+/g, '_'));

        DEBUG.log('Tags', 'Processed new tags', {
            count: newTags.length,
            tagsAfterBlacklist: newTags.length
        });

        let resultTags = [];

        if (config.preserveExistingTags && existingTags.trim()) {
            const existingTagsArray = existingTags.trim().split(/[\s\n]+/).filter(tag => tag.length > 0);
            DEBUG.log('Tags', 'Preserving existing tags', { count: existingTagsArray.length });
            resultTags = [...new Set([...existingTagsArray, ...newTags])];
        } else {
            resultTags = [...new Set(newTags)];
        }

        DEBUG.log('Tags', 'Combined tags after deduplication', { count: resultTags.length });

        resultTags.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

        let groupedTags = {};
        let result;

        switch (config.sortingMode) {
            case 'grouped':
                DEBUG.log('Tags', 'Using grouped sorting mode');
                groupedTags = {};
                resultTags.forEach(tag => {
                    const firstLetter = tag.charAt(0).toLowerCase();
                    if (!groupedTags[firstLetter]) {
                        groupedTags[firstLetter] = [];
                    }
                    groupedTags[firstLetter].push(tag);
                });
                result = Object.keys(groupedTags).sort().map(letter =>
                    groupedTags[letter].join(' ')
                ).join('\n');
                break;

            case 'oneperline':
                DEBUG.log('Tags', 'Using one-per-line sorting mode');
                result = resultTags.join('\n');
                break;

            default:
                DEBUG.log('Tags', 'Using flat sorting mode');
                result = resultTags.join(' ');
                break;
        }

        DEBUG.log('Tags', 'Final formatted tags', {
            length: result.length,
            sortingMode: config.sortingMode
        });

        return result;
    };

    const checkConnection = (updateUI = true) => {
        DEBUG.log('Connection', 'Checking connection to API endpoint', state.config?.localEndpoint);
        return new Promise((resolve, reject) => {
            const config = state.config || loadConfig();

            GM_xmlhttpRequest({
                method: "POST",
                url: config.localEndpoint,
                headers: { "Content-Type": "application/json" },
                data: JSON.stringify({ data: ["", config.confidence], fn_index: 0 }),
                timeout: config.requestTimeout,
                onload: response => {
                    try {
                        JSON.parse(response.responseText);
                        state.lastSuccessfulCheck = Date.now();
                        DEBUG.info('Connection', 'Connection successful');
                        if (updateUI) setConnectionState(true);
                        resolve(true);
                    } catch (e) {
                        if (Date.now() - state.lastSuccessfulCheck > 5000 && updateUI) {
                            setConnectionState(false);
                        }
                        DEBUG.error('Connection', 'Invalid response format', e);
                        reject(new Error("Invalid response format"));
                    }
                },
                onerror: (err) => {
                    if (Date.now() - state.lastSuccessfulCheck > 5000 && updateUI) {
                        setConnectionState(false);
                    }
                    DEBUG.error('Connection', 'Connection failed', err);
                    reject(err);
                },
                ontimeout: () => {
                    if (Date.now() - state.lastSuccessfulCheck > 5000 && updateUI) {
                        setConnectionState(false);
                    }
                    DEBUG.error('Connection', 'Connection timed out');
                    reject(new Error("Connection timed out"));
                }
            });
        });
    };

    const setConnectionState = isConnected => {
        const button = getElement(SELECTORS.button);
        const warningText = getElement(SELECTORS.warningText);

        if (!button || !warningText) return;

        button.textContent = isConnected ? "Generate Tags" : "Connect";
        button.disabled = false;
        button.style.opacity = "1";
        button.style.cursor = "pointer";

        if (isConnected) {
            button.style.backgroundColor = "var(--color-rating-safe, #a6ffb0)";
            button.style.color = "#000";
            button.style.borderColor = "var(--color-rating-safe, #a6ffb0)";
        } else {
            button.style.backgroundColor = "var(--color-rating-questionable, #ffff00)";
            button.style.color = "#000";
            button.style.borderColor = "var(--color-rating-questionable, #ffff00)";
        }

        warningText.textContent = isConnected ? "⚠️ Manually review tags" : "⚠️ Not connected to AI endpoint";
        warningText.style.color = isConnected ? "yellow" : "red";
        warningText.style.fontWeight = "bold";
        warningText.style.fontSize = "14px";
    };

    const startConnectionCheck = () => {
        if (state.connectionCheckInterval) {
            clearInterval(state.connectionCheckInterval);
        }

        checkConnection().catch(() => {});

        state.connectionCheckInterval = setInterval(() => {
            checkConnection().catch(() => {});
        }, 30000);

        return state.connectionCheckInterval;
    };

    const fetchImage = async (imageUrl) => {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: imageUrl,
                responseType: "blob",
                timeout: state.config.requestTimeout,
                onload: response => resolve(response.response),
                onerror: err => reject(new Error(`Error fetching image: ${err.error || 'Unknown error'}`)),
                ontimeout: () => reject(new Error("Image fetch timed out"))
            });
        });
    };

    const sendToAI = async (imageDataUrl, retryCount = 0) => {
        const config = state.config || loadConfig();
        DEBUG.log('API Send', 'Preparing to send to AI with confidence:', config.confidence);

        try {
            return await new Promise((resolve, reject) => {
                const payload = {
                    data: [imageDataUrl, config.confidence],
                    fn_index: 0
                };
                DEBUG.log('API Send', 'Sending payload:', payload);

                GM_xmlhttpRequest({
                    method: "POST",
                    url: config.localEndpoint,
                    headers: {
                        "Content-Type": "application/json",
                        "Accept": "application/json"
                    },
                    data: JSON.stringify(payload),
                    timeout: config.requestTimeout,
                    onload: response => {
                        try {
                            const result = JSON.parse(response.responseText);
                            resolve(result);
                        } catch (err) {
                            reject(new Error(`Invalid AI response: ${err.message}`));
                        }
                    },
                    onerror: err => reject(new Error(`AI request failed: ${err.error || 'Unknown error'}`)),
                    ontimeout: () => reject(new Error("AI request timed out"))
                });
            });
        } catch (error) {
            if (retryCount < config.maxRetries) {
                console.log(`AI request failed, retrying (${retryCount + 1}/${config.maxRetries})...`);
                await new Promise(resolve => setTimeout(resolve, 1000));
                return sendToAI(imageDataUrl, retryCount + 1);
            }
            throw error;
        }
    };

    const processImage = async (button, textarea, throbber) => {
        if (!button || !textarea) {
            DEBUG.warn('Process', 'Missing button or textarea elements');
            return;
        }

        DEBUG.log('Process', 'Starting image processing');

        const img = getElement(SELECTORS.uploadPreview) ||
                    document.querySelector('.upload_preview_container .upload_preview_img') ||
                    document.querySelector('.upload_preview_img') ||
                    document.querySelector('#image') ||
                    document.querySelector('.original-file-unchanged') ||
                    document.querySelector('#image-container img') ||
                    document.querySelector('img[id^="image-"]') ||
                    document.querySelector('.image-container img') ||
                    document.querySelector('#preview img');

        if (!img) {
            DEBUG.error('Process', 'Could not find image preview');
            alert("Could not find the image preview. Please try again.");
            return;
        }

        button.disabled = true;
        button.style.opacity = "0.5";
        if (throbber) textarea.parentElement.insertBefore(throbber, textarea);

        DEBUG.log('Process', 'Found image', { src: img.src, width: img.width, height: img.height });

        try {
            DEBUG.log('Process', 'Fetching image blob');
            const imageBlob = await fetchImage(img.src);
            DEBUG.log('Process', 'Image blob fetched', { size: imageBlob.size, type: imageBlob.type });

            const reader = new FileReader();
            const imageDataUrl = await new Promise((resolve, reject) => {
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(imageBlob);
            });

            DEBUG.log('Process', 'Image converted to base64', { dataUrlLength: imageDataUrl.length });

            DEBUG.log('Process', 'Sending image to AI for processing');
            const aiResponse = await sendToAI(imageDataUrl);

            DEBUG.log('Process', 'Received AI response', aiResponse);

            if (aiResponse.data && aiResponse.data[0]) {
                const tagString = typeof aiResponse.data[0] === 'string' ? aiResponse.data[0] : '';
                const existingTags = state.config.preserveExistingTags ? textarea.value : '';

                DEBUG.info('Process', 'Processing tags', {
                    newTagCount: tagString.split(',').filter(t => t.trim()).length,
                    existingTagCount: existingTags.split(/\s+/).filter(t => t.trim()).length,
                    preserveExisting: state.config.preserveExistingTags
                });

                textarea.value = formatTags(tagString, existingTags);
                DEBUG.info('Process', 'Tags applied to textarea', {
                    finalTagCount: textarea.value.split(/\s+/).filter(t => t.trim()).length
                });

                ['input', 'change'].forEach(eventType => {
                    textarea.dispatchEvent(new Event(eventType, { bubbles: true }));
                });

                if (state.config.rescaleTagBox) {
                    resizeTagBox(textarea);
                }

                textarea.focus();
                textarea.blur();

                state.lastSuccessfulCheck = Date.now();
                setConnectionState(true);
            } else {
                DEBUG.error('Process', 'Invalid AI response format', aiResponse);
                throw new Error("Invalid response format from AI");
            }
        } catch (error) {
            DEBUG.error('Process', 'Error processing image', error);
            alert(error.message);
            checkConnection();
        } finally {
            button.disabled = false;
            button.style.opacity = "1";
            if (throbber) throbber.remove();
            DEBUG.log('Process', 'Image processing completed');
        }
    };

    const addAutocompleteToTextarea = (textarea, containerDiv, isCommaSeparated = false) => {
        if (!textarea || !containerDiv) return;

        const suggestionsClass = isCommaSeparated ? 'tag-suggestions-container-config' : 'tag-suggestions-container';
        const existingSuggestions = containerDiv.querySelector(`.${suggestionsClass}`);
        if (existingSuggestions) return;

        const suggestionsContainer = document.createElement('div');
        suggestionsContainer.className = `${suggestionsClass} tag-suggestions-container`;
        suggestionsContainer.style.zIndex = '1001';
        containerDiv.appendChild(suggestionsContainer);

        let currentSuggestions = [];
        let activeIndex = -1;
        let currentTagSegment = { term: '', start: -1, end: -1 };

        const fetchSuggestions = createDebounce((term) => {
            term = term.trim();
            if (!term || term.length < 3) {
                suggestionsContainer.style.display = 'none';
                currentSuggestions = [];
                activeIndex = -1;
                return;
            }

            suggestionsContainer.innerHTML = '';
            suggestionsContainer.style.display = 'none';

            GM_xmlhttpRequest({
                method: "GET",
                url: `https://e621.net/tags/autocomplete.json?search[name_matches]=${encodeURIComponent(term)}&expiry=7`,
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                onload: (response) => {
                    try {
                        const responseData = JSON.parse(response.responseText);
                        const tags = Array.isArray(responseData) ? responseData : [];

                        if (tags.length === 0) {
                            suggestionsContainer.style.display = 'none';
                            currentSuggestions = [];
                            activeIndex = -1;
                            return;
                        }

                        const fragment = document.createDocumentFragment();
                        currentSuggestions = tags;
                        activeIndex = -1;

                        tags.forEach((tag, index) => {
                            const suggestion = document.createElement('div');
                            suggestion.className = 'tag-suggestion';
                            suggestion.dataset.index = index;
                            suggestion.textContent = tag.name.replace(/_/g, ' ');
                            suggestion.style.color = TAG_CATEGORIES[tag.category] || '#fff';

                            const countLabel = document.createElement('span');
                            countLabel.className = 'tag-count';
                            countLabel.textContent = tag.post_count.toLocaleString();
                            suggestion.appendChild(countLabel);

                            fragment.appendChild(suggestion);
                        });

                        suggestionsContainer.innerHTML = '';
                        suggestionsContainer.appendChild(fragment);

                        suggestionsContainer.addEventListener('click', handleSuggestionClick);
                        suggestionsContainer.addEventListener('mouseover', handleSuggestionMouseover);

                        const rect = textarea.getBoundingClientRect();
                        const parentRect = containerDiv.getBoundingClientRect();
                        suggestionsContainer.style.position = 'absolute';
                        suggestionsContainer.style.top = `${rect.bottom - parentRect.top}px`;
                        suggestionsContainer.style.left = `${rect.left - parentRect.left}px`;
                        suggestionsContainer.style.width = `${rect.width}px`;
                        suggestionsContainer.style.display = 'block';
                    } catch (error) {
                        console.error("Error parsing tag suggestions:", error);
                        suggestionsContainer.style.display = 'none';
                    }
                },
                onerror: () => {
                    suggestionsContainer.style.display = 'none';
                }
            });
        }, 300);

        const handleSuggestionClick = (e) => {
            const suggestion = e.target.closest('.tag-suggestion');
            if (suggestion) {
                const index = parseInt(suggestion.dataset.index, 10);
                if (index >= 0 && index < currentSuggestions.length) {
                    addTagToTextarea(textarea, currentSuggestions[index].name, isCommaSeparated);
                    suggestionsContainer.style.display = 'none';
                }
            }
        };

        const handleSuggestionMouseover = (e) => {
             const suggestion = e.target.closest('.tag-suggestion');
             if (suggestion) {
                 const suggestions = suggestionsContainer.querySelectorAll('.tag-suggestion');
                 suggestions.forEach(s => s.classList.remove('active'));
                 suggestion.classList.add('active');
                 activeIndex = parseInt(suggestion.dataset.index, 10);
             }
         };

        const addTagToTextarea = (textarea, tagName, isList) => {
            const currentValue = textarea.value;
            const cursorPosition = textarea.selectionStart;

            let newValue;
            let newCursorPos;

            if (isList) {
                const segmentStart = currentTagSegment.start;
                const segmentEnd = currentTagSegment.end;

                if (segmentStart === -1 || segmentEnd === -1) {
                    console.error("Cannot add tag: segment info missing.");
                    return;
                }

                const textBeforeSegment = currentValue.substring(0, segmentStart);
                const textAfterSegment = currentValue.substring(segmentEnd);

                let trailingCommaSpace = "";
                const nextChar = textAfterSegment.trimStart().charAt(0);
                 if (textAfterSegment.trim().length > 0 && nextChar !== ',') {
                    trailingCommaSpace = ", ";
                 } else if (textAfterSegment.trimStart().startsWith(',')) {
                     trailingCommaSpace = " ";
                 }

                newValue = textBeforeSegment + tagName + trailingCommaSpace + textAfterSegment.trimStart();
                newCursorPos = textBeforeSegment.length + tagName.length + trailingCommaSpace.length;

            } else {
                const textBeforeCursor = currentValue.substring(0, cursorPosition);
                const textAfterCursor = currentValue.substring(cursorPosition);
                const lastSpacePos = textBeforeCursor.lastIndexOf(' ');
                const startPos = lastSpacePos === -1 ? 0 : lastSpacePos + 1;

                const newTextBeforeCursor = currentValue.substring(0, startPos) + tagName;
                newValue = newTextBeforeCursor + " " + textAfterCursor.trimStart();
                newCursorPos = newTextBeforeCursor.length + 1;
            }

            textarea.value = newValue;
            textarea.setSelectionRange(newCursorPos, newCursorPos);
            textarea.focus();

            ['input', 'change'].forEach(eventType => {
                textarea.dispatchEvent(new Event(eventType, { bubbles: true }));
            });
            suggestionsContainer.style.display = 'none';
            currentSuggestions = [];
            activeIndex = -1;
        };

        const navigateSuggestions = (direction) => {
            const suggestions = suggestionsContainer.querySelectorAll('.tag-suggestion');
            if (!suggestions.length) return;

            if (activeIndex >= 0 && activeIndex < suggestions.length) {
                suggestions[activeIndex].classList.remove('active');
            }

            activeIndex += direction;
            if (activeIndex < 0) activeIndex = suggestions.length - 1;
            if (activeIndex >= suggestions.length) activeIndex = 0;

            suggestions[activeIndex].classList.add('active');
            suggestions[activeIndex].scrollIntoView({ block: 'nearest' });
        };

        const handleInput = (e) => {
            const cursorPosition = textarea.selectionStart;
            const currentValue = textarea.value;
            let term = '';
            let termStart = -1;
            let termEnd = -1;

            if (isCommaSeparated) {
                termStart = currentValue.lastIndexOf(',', cursorPosition - 1);
                termStart = termStart === -1 ? 0 : termStart + 1;

                termEnd = currentValue.indexOf(',', cursorPosition);
                 termEnd = termEnd === -1 ? currentValue.length : termEnd;

                term = currentValue.substring(termStart, termEnd).trim();

                 currentTagSegment = { term: term, start: termStart, end: termEnd };
            } else {
                 const textBeforeCursor = currentValue.substring(0, cursorPosition);
                 const lastSpacePos = textBeforeCursor.lastIndexOf(' ');
                 termStart = lastSpacePos === -1 ? 0 : lastSpacePos + 1;
                 term = textBeforeCursor.substring(termStart).trim();
            }

            fetchSuggestions(term);
        };

        const handleClickOutside = (e) => {
            if (!suggestionsContainer.contains(e.target) && e.target !== textarea) {
                suggestionsContainer.style.display = 'none';
            }
        };

        const handleKeyDown = (e) => {
            if (suggestionsContainer.style.display !== 'block') return;

            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    navigateSuggestions(1);
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    navigateSuggestions(-1);
                    break;
                case 'Enter':
                case 'Tab':
                 {
                    if (activeIndex === -1) return;
                    e.preventDefault();
                    const activeElement = suggestionsContainer.querySelector('.tag-suggestion.active');
                    if (activeElement) {
                        const index = parseInt(activeElement.dataset.index, 10);
                        if (index >= 0 && index < currentSuggestions.length) {
                            addTagToTextarea(textarea, currentSuggestions[index].name, isCommaSeparated);
                        }
                    } else {
                         suggestionsContainer.style.display = 'none';
                    }
                    break;
                }
                case 'Escape':
                    e.preventDefault();
                    suggestionsContainer.style.display = 'none';
                    break;
            }
        };

        registerEventListener(textarea, 'input', handleInput);
        registerEventListener(document, 'click', handleClickOutside);
        registerEventListener(textarea, 'keydown', handleKeyDown);

        return {
            destroy: () => {
                 suggestionsContainer.removeEventListener('click', handleSuggestionClick);
                 suggestionsContainer.removeEventListener('mouseover', handleSuggestionMouseover);
                 suggestionsContainer.remove();
            }
        };
    };

    const createThrobber = () => {
        const throbber = document.createElement('div');
        throbber.className = 'ai-throbber'; // LMAO
        throbber.style.cssText = 'display: inline-block; margin-left: 10px; width: 16px; height: 16px; border: 3px solid rgba(255,255,255,0.3); border-radius: 50%; border-top-color: white; animation: ai-spin 1s linear infinite;';

        const styleAnimation = document.createElement('style');
        styleAnimation.textContent = '@keyframes ai-spin { to { transform: rotate(360deg); } }';
        document.head.appendChild(styleAnimation);

        return throbber;
    };

    const applyConstantTags = (textarea) => {
        if (!textarea) {
            DEBUG.warn('ConstantTags', 'No textarea found');
            return;
        }

        const config = state.config || loadConfig();
        if (!config.constantTags.trim()) {
            DEBUG.log('ConstantTags', 'No constant tags configured, skipping');
            return;
        }

        DEBUG.info('ConstantTags', 'Applying constant tags', { constantTags: config.constantTags });

        const isEditPage = window.location.href.includes('/posts/') && !window.location.href.includes('/uploads/new');
        if (isEditPage && !config.enableAutoTagOnEdit) {
            DEBUG.warn('ConstantTags', 'Constant tags on edit is disabled, skipping constant tags application');
            return;
        }

        const formattedConstantTags = config.constantTags
            .split(',')
            .map(tag => tag.trim())
            .map(tag => tag.replace(/\s+/g, '_'))
            .join(' ');

        DEBUG.log('ConstantTags', 'Formatted constant tags', { formattedConstantTags });

        textarea.value = formatTags(formattedConstantTags, config.preserveExistingTags ? textarea.value : '');
        DEBUG.info('ConstantTags', 'Constant tags applied successfully');

        ['input', 'change'].forEach(eventType => {
            textarea.dispatchEvent(new Event(eventType, { bubbles: true }));
        });
    };

    const getTagTextarea = () => {
        return getElement(SELECTORS.tagTextarea) || getElement(SELECTORS.editTagTextarea);
    };

    const updateConfidence = value => {
        value = Math.max(0.1, Math.min(1, parseFloat(value) || 0.25));
        DEBUG.log('Confidence Update', 'Attempting to save confidence:', value);

        saveConfig({ confidence: value });
        DEBUG.log('Confidence Update', 'Current state.config.confidence after save:', state.config.confidence);

        const input = getElement(SELECTORS.confidenceInput);
        if (input) input.value = value.toFixed(2);

        const configSlider = document.getElementById('confidence-slider');
        if (configSlider) configSlider.value = value;

        const configLabel = document.getElementById('confidence-label');
        if (configLabel) configLabel.textContent = `Confidence Threshold: ${value}`;
    };

    const addControls = () => {
        const textarea = getTagTextarea();
        if (!textarea) return null;

        if (getElement(SELECTORS.button)) return textarea;

        textarea.style.backgroundColor = '#ffffff';
        textarea.style.color = '#000000';

        let textareaContainer = textarea.parentElement;

        if (textareaContainer && textareaContainer.classList.contains('col2')) {
        } else if (textareaContainer) {
        }

        if (!textareaContainer) return null;

        const isUploadPage = window.location.href.includes('/uploads/new');
        const buttonFont = isUploadPage ? 'Arial, sans-serif' : 'Verdana, Geneva, sans-serif';

        const controlsContainer = document.createElement('div');
        controlsContainer.className = 'ai-controls-container';
        controlsContainer.style.cssText = 'display: flex; flex-direction: column; margin-bottom: 10px;';
        textareaContainer.insertBefore(controlsContainer, textarea);

        const warningText = document.createElement('span');
        warningText.className = 'ai-warning-text';
        warningText.textContent = '⚠️ Not connected to AI endpoint';
        warningText.style.cssText = `font-size: 14px; color: red; font-family: ${buttonFont}; font-weight: bold; margin-bottom: 5px;`;
        controlsContainer.appendChild(warningText);

        const controlsRow = document.createElement('div');
        controlsRow.style.cssText = 'display: flex; align-items: center; flex-wrap: wrap;';
        controlsContainer.appendChild(controlsRow);

        const button = document.createElement('button');
        button.className = 'ai-tag-button';
        button.textContent = 'Connect';
        button.style.height = '28px';
        button.style.borderRadius = '6px';
        button.style.fontSize = '16px';
        button.style.marginRight = '10px';
        button.style.fontFamily = buttonFont;
        controlsRow.appendChild(button);

        const sortButton = document.createElement('button');
        sortButton.className = 'ai-sort-button';
        sortButton.textContent = 'Sort';
        sortButton.type = 'button';
        sortButton.style.cssText = `font-size: 16px; padding: 3px 10px; background-color: #ffffff; color: #000000; border: 1px solid #666; border-radius: 6px; height: 28px; font-family: ${buttonFont}; margin-right: 10px;`;
        controlsRow.appendChild(sortButton);

        const confidenceContainer = document.createElement('div');
        confidenceContainer.style.cssText = 'display: flex; align-items: center; margin-right: 10px;';
        controlsRow.appendChild(confidenceContainer);

        const confidenceLabel = document.createElement('label');
        confidenceLabel.textContent = 'Confidence:';
        confidenceLabel.style.cssText = `font-size: 14px; margin-right: 5px; font-family: ${buttonFont};`;
        confidenceContainer.appendChild(confidenceLabel);

        const confidenceInput = document.createElement('input');
        confidenceInput.type = 'number';
        confidenceInput.className = 'ai-confidence-input';
        confidenceInput.min = '0.1';
        confidenceInput.max = '1';
        confidenceInput.step = '0.05';
        confidenceInput.value = (state.config || loadConfig()).confidence;
        confidenceInput.style.cssText = `width: 60px; font-size: 14px; padding: 2px 5px; background-color: #ffffff !important; color: #000000 !important; border: 1px solid #666; border-radius: 6px; height: 28px; font-family: ${buttonFont};`;
        confidenceContainer.appendChild(confidenceInput);

        registerEventListener(button, 'click', async () => {
            if (button.textContent === 'Connect') {
                try {
                    button.disabled = true;
                    button.style.opacity = '0.5';
                    button.textContent = 'Connecting...';
                    await checkConnection(true);
                } catch (error) {
                    alert(`Failed to connect: ${error.message}`);
                    setConnectionState(false);
                } finally {
                    button.disabled = false;
                    button.style.opacity = '1';
                }
            } else {
                const throbber = createThrobber();
                processImage(button, textarea, throbber);
            }
        });

        registerEventListener(confidenceInput, 'change', () => {
            updateConfidence(confidenceInput.value);
        });

        registerEventListener(sortButton, 'click', () => {
            if (!textarea.value.trim()) return;

            const config = state.config || loadConfig();
            textarea.value = formatTags(textarea.value.replace(/\s+/g, ','));

            ['input', 'change'].forEach(eventType => {
                textarea.dispatchEvent(new Event(eventType, { bubbles: true }));
            });

            if (config.rescaleTagBox) {
                resizeTagBox(textarea);
            }
        });

        addAutocompleteToTextarea(textarea, textareaContainer);

        setTimeout(() => applyConstantTags(textarea), 500);

        return textarea;
    };

    const showConfigUI = () => {
        DEBUG.log('Config', 'Opening configuration dialog');
        const existingDialog = document.getElementById('e6-autotagger-config');
        if (existingDialog) {
            DEBUG.log('Config', 'Removing existing dialog');
            existingDialog.remove();
        }

        const config = state.config || loadConfig();
        DEBUG.log('Config', 'Current configuration', config);

        const dialog = document.createElement('dialog');
        dialog.id = 'e6-autotagger-config';
        document.body.appendChild(dialog);

        const form = document.createElement('form');
        form.method = 'dialog';
        form.style.fontFamily = 'Verdana, Geneva, sans-serif';
        dialog.appendChild(form);

        const title = document.createElement('h2');
        title.textContent = 'E6 Autotagger Configuration';
        title.style.marginTop = '0';
        title.style.fontFamily = 'Verdana, Geneva, sans-serif';
        form.appendChild(title);

        addConfigInput(form, 'localEndpoint', 'AI Endpoint URL', config.localEndpoint, 'text',
            'Enter the URL of your local AI endpoint (without /api/predict)');

        const confidenceContainer = document.createElement('div');
        confidenceContainer.className = 'config-row';
        form.appendChild(confidenceContainer);

        const confidenceLabel = document.createElement('label');
        confidenceLabel.id = 'confidence-label';
        confidenceLabel.textContent = `Confidence Threshold: ${config.confidence}`;
        confidenceLabel.style.fontFamily = 'Verdana, Geneva, sans-serif';
        confidenceContainer.appendChild(confidenceLabel);

        const confidenceSlider = document.createElement('input');
        confidenceSlider.type = 'range';
        confidenceSlider.id = 'confidence-slider';
        confidenceSlider.min = '0.1';
        confidenceSlider.max = '1';
        confidenceSlider.step = '0.05';
        confidenceSlider.value = config.confidence;
        confidenceSlider.className = 'config-input';
        confidenceSlider.addEventListener('input', () => {
            confidenceLabel.textContent = `Confidence Threshold: ${confidenceSlider.value}`;
        });
        confidenceContainer.appendChild(confidenceSlider);

        addConfigInput(form, 'requestTimeout', 'Request Timeout (ms)', config.requestTimeout, 'number',
            'Maximum time to wait for API response in milliseconds');

        addConfigInput(form, 'maxRetries', 'Max Retries', config.maxRetries, 'number',
            'Number of times to retry failed requests');

        const blacklistContainer = document.createElement('div');
        blacklistContainer.className = 'config-row';
        form.appendChild(blacklistContainer);
        const blacklistTextarea = addConfigInput(blacklistContainer, 'tagBlacklist', 'Tag Blacklist', config.tagBlacklist, 'textarea',
            'Comma-separated list of tags to exclude');
        addAutocompleteToTextarea(blacklistTextarea, blacklistContainer, true);

        const autoTagsContainer = document.createElement('div');
        autoTagsContainer.className = 'config-row';
        form.appendChild(autoTagsContainer);
        const autoTagsTextarea = addConfigInput(autoTagsContainer, 'constantTags', 'Constant Tags', config.constantTags, 'textarea',
            'Comma-separated list of tags to add automatically');
        addAutocompleteToTextarea(autoTagsTextarea, autoTagsContainer, true);

        addConfigCheckbox(form, 'preserveExistingTags', 'Preserve Existing Tags', config.preserveExistingTags,
            'Keep existing tags when generating new ones');

        addConfigCheckbox(form, 'rescaleTagBox', 'Rescale Tag Box on Sort/Generate', config.rescaleTagBox,
            'Automatically resize the tag box to show all tags');

        addConfigCheckbox(form, 'enableAutoTagOnEdit', 'Enable Constant Tags on Edit', config.enableAutoTagOnEdit,
            'Apply constant tags when editing existing posts');

        const sortingContainer = document.createElement('div');
        sortingContainer.className = 'config-row';
        form.appendChild(sortingContainer);

        const sortingLabel = document.createElement('label');
        sortingLabel.textContent = 'Tag Sorting Mode';
        sortingLabel.style.fontFamily = 'Verdana, Geneva, sans-serif';
        sortingContainer.appendChild(sortingLabel);

        const sortingSelect = document.createElement('select');
        sortingSelect.className = 'config-input';
        sortingSelect.name = 'sortingMode';
        sortingSelect.style.height = 'auto';
        sortingSelect.style.padding = '5px';

        const sortingModes = [
            { value: 'flat', label: 'Flat (space-separated)' },
            { value: 'grouped', label: 'Grouped (by first letter)' },
            { value: 'oneperline', label: 'One tag per line' }
        ];

        sortingModes.forEach(mode => {
            const option = document.createElement('option');
            option.value = mode.value;
            option.textContent = mode.label;
            option.selected = config.sortingMode === mode.value;
            sortingSelect.appendChild(option);
        });

        sortingContainer.appendChild(sortingSelect);

        const buttonsContainer = document.createElement('div');
        buttonsContainer.style.cssText = 'display: flex; justify-content: space-between; margin-top: 20px;';
        form.appendChild(buttonsContainer);

        const testButton = document.createElement('button');
        testButton.textContent = 'Test Connection';
        testButton.type = 'button';
        testButton.style.cssText = 'padding: 8px 16px; background-color: #ffffff; color: #000000; border: 1px solid #666; border-radius: 6px; cursor: pointer; height: 28px; font-family: Verdana, Geneva, sans-serif; font-size: 12px;';
        buttonsContainer.appendChild(testButton);

        const buttonGroup = document.createElement('div');
        buttonsContainer.appendChild(buttonGroup);

        const cancelButton = document.createElement('button');
        cancelButton.textContent = 'Cancel';
        cancelButton.type = 'button';
        cancelButton.style.cssText = 'padding: 8px 16px; background-color: #ffffff; color: #000000; border: 1px solid #666; border-radius: 6px; cursor: pointer; margin-right: 10px; height: 28px; font-family: Verdana, Geneva, sans-serif; font-size: 12px;';
        buttonGroup.appendChild(cancelButton);

        const saveButton = document.createElement('button');
        saveButton.textContent = 'Save';
        saveButton.type = 'button';
        saveButton.style.cssText = 'padding: 8px 16px; background-color: #ffffff; color: #000000; border: 1px solid #666; border-radius: 6px; cursor: pointer; height: 28px; font-family: Verdana, Geneva, sans-serif; font-size: 12px;';
        buttonGroup.appendChild(saveButton);

        const statusArea = document.createElement('div');
        statusArea.className = 'config-status';
        statusArea.style.display = 'none';
        form.appendChild(statusArea);

        function addConfigInput(parent, name, label, value, type, placeholder) {
            const labelElem = document.createElement('label');
            labelElem.textContent = label;
            labelElem.style.fontFamily = 'Verdana, Geneva, sans-serif';
            parent.appendChild(labelElem);

            const input = document.createElement(type === 'textarea' ? 'textarea' : 'input');
            if (type !== 'textarea') input.type = type;
            input.className = 'config-input';
            input.name = name;
            input.value = value;
            input.placeholder = placeholder;
            if (type === 'textarea') input.rows = 3;
            input.style.backgroundColor = '#ffffff';
            input.style.color = '#000000';
            input.style.fontFamily = 'Verdana, Geneva, sans-serif';
            input.style.height = type === 'textarea' ? 'auto' : '28px';
            parent.appendChild(input);

            return input;
        }

        function addConfigCheckbox(parent, name, label, checked, description) {
            const container = document.createElement('div');
            container.className = 'config-row';
            container.style.display = 'flex';
            container.style.alignItems = 'center';
            parent.appendChild(container);

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.name = name;
            checkbox.checked = checked;
            checkbox.style.marginRight = '10px';
            container.appendChild(checkbox);

            const labelElem = document.createElement('label');
            labelElem.textContent = label;
            labelElem.style.fontFamily = 'Verdana, Geneva, sans-serif';
            container.appendChild(labelElem);

            if (description) {
                const descElem = document.createElement('span');
                descElem.textContent = ` - ${description}`;
                descElem.style.fontSize = '12px';
                descElem.style.opacity = '0.8';
                descElem.style.fontFamily = 'Verdana, Geneva, sans-serif';
                container.appendChild(descElem);
            }

            return checkbox;
        }

        const showStatus = (message, isError = false) => {
            statusArea.textContent = message;
            statusArea.style.backgroundColor = isError ? '#ff3333' : '#4caf50';
            statusArea.style.color = 'white';
            statusArea.style.display = 'block';

            setTimeout(() => {
                statusArea.style.display = 'none';
            }, 3000);
        };

        registerEventListener(testButton, 'click', async () => {
            testButton.disabled = true;

            try {
                const endpointInput = form.querySelector('input[name="localEndpoint"]');
                const endpoint = endpointInput.value.trim();

                if (!endpoint) {
                    throw new Error('Endpoint URL is required');
                }

                const originalEndpoint = config.localEndpoint;
                const formattedEndpoint = endpoint.endsWith('/api/predict') ?
                    endpoint : endpoint.replace(/\/$/, '') + '/api/predict';

                state.config = { ...config, localEndpoint: formattedEndpoint };

                await checkConnection(false);
                showStatus('Connection successful!');

                state.config = { ...config, localEndpoint: originalEndpoint };
            } catch (error) {
                showStatus(`Connection failed: ${error.message}`, true);
            } finally {
                testButton.disabled = false;
            }
        });

        registerEventListener(saveButton, 'click', () => {
            try {
                DEBUG.log('Config', 'Saving configuration');
                const newConfig = {
                    localEndpoint: form.querySelector('[name="localEndpoint"]').value.trim(),
                    confidence: parseFloat(form.querySelector('#confidence-slider').value),
                    tagBlacklist: form.querySelector('[name="tagBlacklist"]').value.trim(),
                    constantTags: form.querySelector('[name="constantTags"]').value.trim(),
                    preserveExistingTags: form.querySelector('[name="preserveExistingTags"]').checked,
                    rescaleTagBox: form.querySelector('[name="rescaleTagBox"]').checked,
                    enableAutoTagOnEdit: form.querySelector('[name="enableAutoTagOnEdit"]').checked,
                    sortingMode: form.querySelector('[name="sortingMode"]').value,
                    requestTimeout: parseInt(form.querySelector('[name="requestTimeout"]').value) || DEFAULT_CONFIG.requestTimeout,
                    maxRetries: parseInt(form.querySelector('[name="maxRetries"]').value) || DEFAULT_CONFIG.maxRetries
                };

                saveConfig(newConfig);
                DEBUG.info('Config', 'Configuration saved successfully');

                const confidenceInput = getElement(SELECTORS.confidenceInput);
                if (confidenceInput) confidenceInput.value = newConfig.confidence;

                setTimeout(() => {
                    try {
                        checkConnection().catch(err => {
                            DEBUG.error('Config', 'Connection check failed after saving settings', err);
                        });
                    } catch (err) {
                        DEBUG.error('Config', 'Error during connection check', err);
                    }
                }, 0);

                showStatus('Settings saved successfully!');
            } catch (error) {
                DEBUG.error('Config', 'Error saving settings', error);
                console.error('Error saving settings:', error);
                showStatus(`Error saving settings: ${error.message}`, true);
            }
        });

        const closeDialog = () => {
            const suggestionContainers = dialog.querySelectorAll('.tag-suggestions-container');
            suggestionContainers.forEach(container => {
                container.style.display = 'none';
            });
            dialog.close();
            setTimeout(() => {
                dialog.remove();
            }, 100);
        };

        registerEventListener(cancelButton, 'click', closeDialog);

        registerEventListener(saveButton, 'click', () => {
            try {
                DEBUG.log('Config', 'Saving configuration');
                const newConfig = {
                    localEndpoint: form.querySelector('[name="localEndpoint"]').value.trim(),
                    confidence: parseFloat(form.querySelector('#confidence-slider').value),
                    tagBlacklist: form.querySelector('[name="tagBlacklist"]').value.trim(),
                    constantTags: form.querySelector('[name="constantTags"]').value.trim(),
                    preserveExistingTags: form.querySelector('[name="preserveExistingTags"]').checked,
                    rescaleTagBox: form.querySelector('[name="rescaleTagBox"]').checked,
                    enableAutoTagOnEdit: form.querySelector('[name="enableAutoTagOnEdit"]').checked,
                    sortingMode: form.querySelector('[name="sortingMode"]').value,
                    requestTimeout: parseInt(form.querySelector('[name="requestTimeout"]').value) || DEFAULT_CONFIG.requestTimeout,
                    maxRetries: parseInt(form.querySelector('[name="maxRetries"]').value) || DEFAULT_CONFIG.maxRetries
                };

                saveConfig(newConfig);
                DEBUG.info('Config', 'Configuration saved successfully');

                const confidenceInput = getElement(SELECTORS.confidenceInput);
                if (confidenceInput) confidenceInput.value = newConfig.confidence;

                setTimeout(() => {
                    try {
                        checkConnection().catch(err => {
                            DEBUG.error('Config', 'Connection check failed after saving settings', err);
                        });
                    } catch (err) {
                        DEBUG.error('Config', 'Error during connection check', err);
                    }
                }, 0);

                showStatus('Settings saved successfully!');

                setTimeout(closeDialog, 1500);
            } catch (error) {
                DEBUG.error('Config', 'Error saving settings', error);
                console.error('Error saving settings:', error);
                showStatus(`Error saving settings: ${error.message}`, true);
            }
        });

        registerEventListener(dialog, 'click', (e) => {
            if (e.target === dialog) {
                closeDialog();
            }
        });

        dialog.showModal();
    };

    const checkForEditPage = () => {
        const currentUrl = window.location.href;

        if (currentUrl.includes('/posts/') && !currentUrl.includes('/uploads/new')) {
            const tagTextarea = getTagTextarea();
            if (tagTextarea) {
                if (!state.initializedPages.has(currentUrl)) {
                    console.log("Detected edit page with tag textarea, initializing...");
                    state.initializedPages.add(currentUrl);
                    init();
                }
                return;
            }

            const sideEditButton = document.getElementById('side-edit-link');
            const postEditButton = document.getElementById('post-edit-link');

            const editButtons = [sideEditButton, postEditButton].filter(button => button !== null);

            if (editButtons.length > 0 && !state.isWatchingEditButton) {
                console.log("Found edit buttons, watching for clicks...");
                state.isWatchingEditButton = true;

                const handleEditAction = () => {
                    console.log("Edit action triggered, waiting for tag textarea...");

                    setTimeout(() => {
                        const textarea = getTagTextarea();
                        if (textarea) {
                            console.log("Tag textarea found immediately after edit action");
                            if (!state.initializedPages.has(currentUrl)) {
                                state.initializedPages.add(currentUrl);
                                init();
                            }
                            return;
                        }

                        const observer = registerObserver(new MutationObserver((mutations, obs) => {
                            const tagTextarea = getTagTextarea();
                            if (tagTextarea) {
                                console.log("Tag textarea appeared after edit action");
                                obs.disconnect();

                                setTimeout(() => {
                                    if (!state.initializedPages.has(currentUrl)) {
                                        state.initializedPages.add(currentUrl);
                                        init();
                                    }
                                }, 300);
                            }
                        }));

                        observer.observe(document.body, {
                            childList: true,
                            subtree: true,
                            attributes: true,
                            characterData: false
                        });

                        setTimeout(() => {
                            observer.disconnect();
                        }, 10000);
                    }, 300);
                };

                editButtons.forEach(button => {
                    registerEventListener(button, 'click', handleEditAction);
                });

                registerEventListener(document, 'keydown', (e) => {
                    if (e.key === 'e' &&
                        !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) &&
                        !e.ctrlKey && !e.altKey && !e.metaKey) {
                        handleEditAction();
                    }
                });
            }
        }
    };

    const handleUrlChange = () => {
        let lastUrl = location.href;

        console.log("Setting up URL change monitor");

        const observer = registerObserver(new MutationObserver(() => {
            if (location.href !== lastUrl) {
                console.log("URL changed from", lastUrl, "to", location.href);
                lastUrl = location.href;

                clearResources();
                state.initializedPages.clear();
                state.isWatchingEditButton = false;

                setTimeout(() => {
                    checkForEditPage();
                }, 500);
            }
        }));

        observer.observe(document, {subtree: true, childList: true});
    };

    const init = () => {
        DEBUG.info('Init', 'Initializing E6 Autotagger');
        loadConfig();
        addStyles();

        const textarea = addControls();
        if (textarea) {
            DEBUG.log('Init', 'Found tag textarea, adding controls');
            startConnectionCheck();
            state.initializedPages.add(window.location.href);
            DEBUG.info('Init', 'E6 Autotagger initialized successfully', { url: window.location.href });
        } else {
            DEBUG.log("Init", "No tag textarea found, may be on a view-only page");
            checkForEditPage();
        }
    };

    GM_registerMenuCommand('Configure E6 Autotagger', showConfigUI);

    if (document.readyState === "complete" || document.readyState === "interactive") {
        setTimeout(init, 1);
    } else {
        registerEventListener(document, "DOMContentLoaded", init);
        registerEventListener(window, "load", init);
    }

    registerEventListener(document, "DOMContentLoaded", () => {
        setTimeout(checkForEditPage, 500);
    });

    registerEventListener(window, "load", () => {
        setTimeout(checkForEditPage, 500);
        handleUrlChange();
    });

    const resizeTagBox = (textarea) => {
        if (!textarea) return;

        const lineHeight = parseInt(window.getComputedStyle(textarea).lineHeight) || 18;
        const paddingTop = parseInt(window.getComputedStyle(textarea).paddingTop) || 5;
        const paddingBottom = parseInt(window.getComputedStyle(textarea).paddingBottom) || 5;

        const lines = textarea.value.split('\n');
        const lineCount = lines.length || 1;

        let extraLines = 0;
        const width = textarea.clientWidth;
        const charWidth = 8;
        const charsPerLine = Math.floor(width / charWidth);

        lines.forEach(line => {
            if (line.length > charsPerLine) {
                extraLines += Math.floor(line.length / charsPerLine);
            }
        });

        const totalLines = lineCount + extraLines;
        const newHeight = (totalLines * lineHeight) + paddingTop + paddingBottom;

        const finalHeight = Math.max(100, Math.min(500, newHeight));
        textarea.style.height = finalHeight + 'px';
    };
})();