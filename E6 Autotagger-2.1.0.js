// ==UserScript==
// @name         E6 Autotagger 2.1.0
// @version      2.1.0
// @author       Jax (Slop_Dragon)
// @description  Adds a button that automatically tags e621 images using local AI
// @icon         https://www.google.com/s2/favicons?domain=e621.net
// @match        https://e621.net/uploads/new
// @match        https://e926.net/uploads/new
// @match        https://e6ai.net/uploads/new
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



// TO WHOM READS THIS CODE BE WARNED IT SUCKS!!!!!!!!!!
(function() {
    'use strict';

    const DEFAULT_CONFIG = {
        localEndpoint: 'http://127.0.0.1:7860',
        confidence: 0.25,
        tagBlacklist: '',
        autoTags: '',
        preserveExistingTags: false
    };

    const selectors = {
        button: '.ai-tag-button',
        warningText: '.ai-warning-text',
        confidenceInput: '.ai-confidence-input',
        uploadPreview: '.upload_preview_img'
    };

    let connectionCheckInterval;
    let lastSuccessfulCheck = 0;
    let autocompleteCache = {};
    let autocompleteTimer = null;

    const getConfig = () => {
        const config = {
            localEndpoint: GM_getValue('localEndpoint', DEFAULT_CONFIG.localEndpoint),
            confidence: GM_getValue('confidence', DEFAULT_CONFIG.confidence),
            tagBlacklist: GM_getValue('tagBlacklist', DEFAULT_CONFIG.tagBlacklist),
            autoTags: GM_getValue('autoTags', DEFAULT_CONFIG.autoTags),
            preserveExistingTags: GM_getValue('preserveExistingTags', DEFAULT_CONFIG.preserveExistingTags)
        };

        if (!config.localEndpoint.endsWith('/api/predict')) {
            config.localEndpoint = config.localEndpoint.replace(/\/$/, '') + '/api/predict';
        }

        return config;
    };

    const getElement = selector => document.querySelector(selector);

    const normalizeTag = tag => {
        tag = tag.toLowerCase().trim();
        return tag.includes(' ') ? tag.replace(/\s+/g, '_') :
               tag.includes('_') ? tag.replace(/_+/g, '_') : tag;
    };

    const formatTags = (tagString, existingTags = '') => {
        const config = getConfig();
        const blacklist = config.tagBlacklist
            .split(',')
            .map(normalizeTag)
            .filter(tag => tag.length > 0);

        const newTags = tagString.split(',')
            .map(tag => tag.trim())
            .filter(tag => !blacklist.includes(normalizeTag(tag)))
            .map(tag => tag.replace(/\s+/g, '_'));

        if (config.preserveExistingTags && existingTags.trim()) {
            const existingTagsArray = existingTags.trim().split(/\s+/);
            const combinedTags = [...new Set([...existingTagsArray, ...newTags])];
            return combinedTags.join(' ');
        }

        return newTags.join(' ');
    };

    const applyAutoTags = (textarea) => {
        const config = getConfig();
        if (!textarea || !config.autoTags.trim()) return;

        const formattedAutoTags = config.autoTags
            .split(',')
            .map(tag => tag.trim())
            .map(tag => tag.replace(/\s+/g, '_'))
            .join(' ');

        if (config.preserveExistingTags && textarea.value.trim()) {
            textarea.value = formatTags(formattedAutoTags, textarea.value);
        } else {
            textarea.value = formattedAutoTags;
        }

        ['input', 'change'].forEach(eventType => {
            textarea.dispatchEvent(new Event(eventType, { bubbles: true }));
        });
    };

    const setConnectionState = isConnected => {
        const button = getElement(selectors.button);
        const warningText = getElement(selectors.warningText);

        if (!button || !warningText) return;

        button.textContent = isConnected ? "Auto Tag" : "Connect";
        button.disabled = false;
        button.style.opacity = "1";
        button.style.cursor = "pointer";
        warningText.textContent = isConnected ? "⚠️ Manually review tags" : "⚠️ Not connected to JTP Pilot";
        warningText.style.color = isConnected ? "yellow" : "red";
    };

    const updateConfidence = value => {
        value = Math.max(0.1, Math.min(1, parseFloat(value) || 0.25));
        GM_setValue('confidence', value);
        const input = getElement(selectors.confidenceInput);
        if (input) input.value = value.toFixed(2);
    };

    const checkConnection = () => {
        const config = getConfig();
        const button = getElement(selectors.button);

        if (!button) return;

        GM_xmlhttpRequest({
            method: "POST",
            url: config.localEndpoint,
            headers: { "Content-Type": "application/json" },
            data: JSON.stringify({ data: ["", config.confidence], fn_index: 0 }),
            timeout: 5000,
            onload: response => {
                try {
                    JSON.parse(response.responseText);
                    lastSuccessfulCheck = Date.now();
                    setConnectionState(true);
                } catch (e) {
                    if (Date.now() - lastSuccessfulCheck > 10000) {
                        setConnectionState(false);
                    }
                }
            },
            onerror: () => {
                if (Date.now() - lastSuccessfulCheck > 10000) {
                    setConnectionState(false);
                }
            },
            ontimeout: () => {
                if (Date.now() - lastSuccessfulCheck > 10000) {
                    setConnectionState(false);
                }
            }
        });
    };

    const processImage = (button, textarea, throbber) => {
        const config = getConfig();
        const img = getElement(selectors.uploadPreview);

        if (!img) return;

        button.disabled = true;
        button.style.opacity = "0.5";
        textarea.parentElement.insertBefore(throbber, textarea);

        const handleAIResponse = aiResponse => {
            try {
                const json = JSON.parse(aiResponse.responseText);
                if (textarea && json.data && json.data[0]) {
                    const existingTags = config.preserveExistingTags ? textarea.value : '';

                    textarea.value = formatTags(json.data[0], existingTags);

                    ['input', 'change'].forEach(eventType => {
                        textarea.dispatchEvent(new Event(eventType, { bubbles: true }));
                    });

                    textarea.focus();
                    textarea.blur();

                    lastSuccessfulCheck = Date.now();
                    setConnectionState(true);
                } else {
                    alert("Invalid response format from AI");
                    checkConnection();
                }
            } catch (err) {
                alert("Error parsing AI response: " + err.message);
                checkConnection();
            }
            button.disabled = false;
            button.style.opacity = "1";
            throbber.remove();
        };

        GM_xmlhttpRequest({
            method: "GET",
            url: img.src,
            responseType: "blob",
            onload: response => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    GM_xmlhttpRequest({
                        method: "POST",
                        url: config.localEndpoint,
                        headers: {
                            "Content-Type": "application/json",
                            "Accept": "application/json"
                        },
                        data: JSON.stringify({
                            data: [reader.result, config.confidence],
                            fn_index: 0
                        }),
                        onload: handleAIResponse,
                        onerror: err => {
                            alert("Error connecting to AI: " + err.error);
                            checkConnection();
                            button.disabled = false;
                            button.style.opacity = "1";
                            throbber.remove();
                        }
                    });
                };
                reader.readAsDataURL(response.response);
            },
            onerror: err => {
                alert("Error fetching image: " + err.error);
                button.disabled = false;
                button.style.opacity = "1";
                throbber.remove();
            }
        });
    };

    const fetchTagSuggestions = (term, callback) => {
        if (term.length < 2) {
            callback([]);
            return;
        }

        if (autocompleteTimer) {
            clearTimeout(autocompleteTimer);
        }

        const cacheKey = term.toLowerCase();
        if (autocompleteCache[cacheKey]) {
            callback(autocompleteCache[cacheKey]);
            return;
        }

        autocompleteTimer = setTimeout(() => {
            let queryTerm = term;
            if (!queryTerm.endsWith('*')) {
                queryTerm = queryTerm + '*';
            }

            const currentDomain = window.location.hostname;
            const apiUrl = `https://${currentDomain}/tags/autocomplete.json?search[name_matches]=${encodeURIComponent(queryTerm)}&expiry=7&limit=20`;

            GM_xmlhttpRequest({
                method: "GET",
                url: apiUrl,
                responseType: "json",
                headers: {
                    "Accept": "application/json"
                },
                onload: response => {
                    try {
                        let tags = response.response;

                        if (Array.isArray(tags) && tags.length > 0) {
                            const lowerTerm = term.toLowerCase();
                            tags = tags.filter(tag =>
                                tag.name.toLowerCase().startsWith(lowerTerm)
                            );

                            tags.sort((a, b) => {
                                const aExact = a.name.toLowerCase() === lowerTerm;
                                const bExact = b.name.toLowerCase() === lowerTerm;

                                if (aExact && !bExact) return -1;
                                if (!aExact && bExact) return 1;

                                const aStartsWith = a.name.toLowerCase().startsWith(lowerTerm);
                                const bStartsWith = b.name.toLowerCase().startsWith(lowerTerm);

                                if (aStartsWith && !bStartsWith) return -1;
                                if (!aStartsWith && bStartsWith) return 1;

                                return b.post_count - a.post_count;
                            });

                            autocompleteCache[cacheKey] = tags;
                            const cacheKeys = Object.keys(autocompleteCache);
                            if (cacheKeys.length > 50) {
                                delete autocompleteCache[cacheKeys[0]];
                            }
                            callback(tags);
                        } else {
                            callback([]);
                        }
                    } catch (error) {
                        callback([]);
                    }
                },
                onerror: () => {
                    callback([]);
                }
            });
        }, 150);
    };

    const setupTagAutocomplete = (textarea) => {
        const dropdown = document.createElement('div');
        dropdown.className = 'e6-tag-autocomplete';
        dropdown.style.cssText = `
            display: none;
            position: absolute;
            background-color: #2a2a2a;
            border: 1px solid #666;
            z-index: 1000;
            max-height: 300px;
            overflow-y: auto;
            width: ${textarea.offsetWidth}px;
            box-shadow: 0 2px 5px rgba(0, 0, 0, 0.3);
            left: 0;
            top: ${textarea.offsetHeight}px;
        `;

        const container = document.createElement('div');
        container.style.position = 'relative';
        textarea.parentNode.insertBefore(container, textarea);
        container.appendChild(textarea);
        container.appendChild(dropdown);

        let selectedIndex = -1;
        let suggestions = [];

        const getCurrentWord = () => {
            const cursorPos = textarea.selectionStart;
            const text = textarea.value;

            if (!text || cursorPos === 0) {
                return { word: '', startPos: 0, endPos: 0 };
            }

            let wordStart = 0;
            for (let i = cursorPos - 1; i >= 0; i--) {
                if (text[i] === ',' || text[i] === ' ') {
                    wordStart = i + 1;
                    break;
                }
            }

            let wordEnd = text.length;
            for (let i = cursorPos; i < text.length; i++) {
                if (text[i] === ',' || text[i] === ' ') {
                    wordEnd = i;
                    break;
                }
            }

            const currentWord = text.substring(wordStart, wordEnd).trim();

            return {
                word: currentWord,
                startPos: wordStart,
                endPos: cursorPos > wordEnd ? wordEnd : cursorPos
            };
        };

        const updateDropdown = (tags) => {
            if (!tags.length) {
                dropdown.innerHTML = '<div style="padding: 5px; text-align: center;">No matches found</div>';
                return;
            }

            suggestions = tags;
            selectedIndex = -1;

            dropdown.innerHTML = '';

            const fragment = document.createDocumentFragment();

            tags.forEach((tag, index) => {
                const item = document.createElement('div');
                item.className = 'e6-autocomplete-item';

                const name = tag.name.replace(/_/g, ' ');
                const count = tag.post_count >= 1000
                    ? Math.floor(tag.post_count / 1000) + 'k'
                    : tag.post_count;

                const categoryClasses = {
                    0: 'general',
                    1: 'artist',
                    3: 'copyright',
                    4: 'character',
                    5: 'species',
                    6: 'invalid',
                    7: 'meta'
                };

                const categoryClass = categoryClasses[tag.category] || 'general';

                const tagNameSpan = document.createElement('span');
                tagNameSpan.className = `tag-name tag-type-${categoryClass}`;
                tagNameSpan.textContent = name;

                const tagCountSpan = document.createElement('span');
                tagCountSpan.className = 'tag-count';
                tagCountSpan.textContent = count;

                item.style.cssText = `
                    padding: 5px 8px;
                    cursor: pointer;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                `;

                item.appendChild(tagNameSpan);
                item.appendChild(tagCountSpan);

                item.addEventListener('mouseover', () => {
                    selectedIndex = index;
                    highlightSelected();
                });

                item.addEventListener('click', () => {
                    insertTag(tag.name);
                });

                fragment.appendChild(item);
            });

            dropdown.appendChild(fragment);
            dropdown.style.top = textarea.offsetHeight + 'px';
            dropdown.style.display = 'block';
            dropdown.style.width = textarea.offsetWidth + 'px';
        };

        const highlightSelected = () => {
            const items = dropdown.querySelectorAll('.e6-autocomplete-item');
            items.forEach((item, i) => {
                item.style.backgroundColor = i === selectedIndex ? '#4a4a4a' : '';
            });

            if (selectedIndex >= 0) {
                const selectedItem = items[selectedIndex];
                if (selectedItem) {
                    if (selectedItem.offsetTop < dropdown.scrollTop) {
                        dropdown.scrollTop = selectedItem.offsetTop;
                    } else if (selectedItem.offsetTop + selectedItem.offsetHeight > dropdown.scrollTop + dropdown.offsetHeight) {
                        dropdown.scrollTop = selectedItem.offsetTop + selectedItem.offsetHeight - dropdown.offsetHeight;
                    }
                }
            }
        };

        const insertTag = (tagName) => {
            const { word, startPos, endPos } = getCurrentWord();
            const text = textarea.value;

            let newText;
            const charBefore = startPos > 0 ? text.charAt(startPos - 1) : '';

            let separator = '';
            if (endPos < text.length) {
                const charAfter = text.charAt(endPos);
                if (charAfter !== ' ' && charAfter !== ',') {
                    separator = ' ';
                }
            }

            if (startPos > 0 && charBefore !== ' ' && charBefore !== ',') {
                newText = text.substring(0, startPos) + ' ' + tagName + separator + text.substring(endPos);
                const newCursorPos = startPos + tagName.length + 1 + separator.length;
                textarea.value = newText;
                textarea.setSelectionRange(newCursorPos, newCursorPos);
            } else {
                newText = text.substring(0, startPos) + tagName + separator + text.substring(endPos);
                const newCursorPos = startPos + tagName.length + separator.length;
                textarea.value = newText;
                textarea.setSelectionRange(newCursorPos, newCursorPos);
            }

            dropdown.style.display = 'none';
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.focus();
        };

        textarea.addEventListener('input', () => {
            const { word } = getCurrentWord();

            if (word && word.length >= 2) {
                if (dropdown.style.display === 'none') {
                    dropdown.innerHTML = '<div style="padding: 5px; text-align: center;">Loading...</div>';
                    dropdown.style.display = 'block';
                }
                fetchTagSuggestions(word, updateDropdown);
            } else {
                dropdown.style.display = 'none';
            }
        });

        textarea.addEventListener('keydown', (e) => {
            if (dropdown.style.display === 'none') return;

            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    selectedIndex = Math.min(selectedIndex + 1, suggestions.length - 1);
                    highlightSelected();
                    break;

                case 'ArrowUp':
                    e.preventDefault();
                    selectedIndex = Math.max(selectedIndex - 1, 0);
                    highlightSelected();
                    break;

                case 'Enter':
                    if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
                        e.preventDefault();
                        insertTag(suggestions[selectedIndex].name);
                    }
                    break;

                case 'Escape':
                    e.preventDefault();
                    dropdown.style.display = 'none';
                    break;

                case 'Tab':
                    if (suggestions.length > 0) {
                        e.preventDefault();
                        insertTag(suggestions[selectedIndex >= 0 ? selectedIndex : 0].name);
                    }
                    break;
            }
        });

        textarea.addEventListener('keyup', (e) => {
            const { word } = getCurrentWord();

            if (e.key === ' ' && word && word.length >= 2) {
                fetchTagSuggestions(word, updateDropdown);
            }

            if (e.key === 'Backspace' || e.key === 'Delete' ||
                e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                const { word } = getCurrentWord();

                if (word && word.length >= 2) {
                    fetchTagSuggestions(word, updateDropdown);
                } else {
                    dropdown.style.display = 'none';
                }
            }
        });

        document.addEventListener('click', (e) => {
            if (!dropdown.contains(e.target) && e.target !== textarea) {
                dropdown.style.display = 'none';
            }
        });

        window.addEventListener('resize', () => {
            if (dropdown.style.display !== 'none') {
                dropdown.style.width = textarea.offsetWidth + 'px';
            }
        });

        const style = document.createElement('style');
        style.textContent = `
            .tag-type-general { color: #EEE; }
            .tag-type-artist { color: #F2AC08; }
            .tag-type-copyright { color: #DD00DD; }
            .tag-type-character { color: #00AA00; }
            .tag-type-species { color: #ED5D1F; }
            .tag-type-invalid { color: #FF3D3D; }
            .tag-type-meta { color: #2E76B4; }
            .e6-autocomplete-item:hover { background-color: #4a4a4a; }
            .tag-count { color: #888; font-size: 0.9em; }
        `;
        document.head.appendChild(style);

        return dropdown;
    };

    const showConfigUI = () => {
        const config = getConfig();

        let displayEndpoint = config.localEndpoint;
        if (displayEndpoint.endsWith('/api/predict')) {
            displayEndpoint = displayEndpoint.substring(0, displayEndpoint.length - 12);
        }

        const dialog = document.createElement('dialog');
        dialog.style.cssText = 'padding: 20px; border-radius: 8px; background-color: #2a2a2a; color: #fff; border: 1px solid #666; min-width: 400px;';

        const form = document.createElement('form');
        form.style.cssText = 'display: flex; flex-direction: column; gap: 15px;';

        const endpointLabel = document.createElement('label');
        endpointLabel.textContent = 'Local AI Endpoint URL:';
        const endpointInput = document.createElement('input');
        endpointInput.type = 'text';
        endpointInput.value = displayEndpoint;
        endpointInput.style.cssText = 'width: 100%; padding: 5px;';
        endpointInput.placeholder = 'http://127.0.0.1:7860';

        const blacklistContainer = document.createElement('div');
        blacklistContainer.style.cssText = 'display: flex; flex-direction: column; gap: 5px; position: relative;';

        const blacklistLabel = document.createElement('label');
        blacklistLabel.textContent = 'Tag Blacklist:';
        const blacklistInput = document.createElement('textarea');
        blacklistInput.value = config.tagBlacklist;
        blacklistInput.style.cssText = 'width: 100%; height: 100px; padding: 5px;';
        blacklistInput.placeholder = 'Tags you do not want (comma separated)';

        blacklistContainer.appendChild(blacklistLabel);
        blacklistContainer.appendChild(blacklistInput);

        const autoTagsContainer = document.createElement('div');
        autoTagsContainer.style.cssText = 'display: flex; flex-direction: column; gap: 5px; position: relative;';

        const autoTagsLabel = document.createElement('label');
        autoTagsLabel.textContent = 'Auto Tags:';
        const autoTagsInput = document.createElement('textarea');
        autoTagsInput.value = config.autoTags;
        autoTagsInput.style.cssText = 'width: 100%; height: 100px; padding: 5px;';
        autoTagsInput.placeholder = 'Tags to automatically add (comma separated)';

        autoTagsContainer.appendChild(autoTagsLabel);
        autoTagsContainer.appendChild(autoTagsInput);

        const preserveTagsContainer = document.createElement('div');
        preserveTagsContainer.style.cssText = 'display: flex; align-items: center; gap: 5px;';

        const preserveTagsInput = document.createElement('input');
        preserveTagsInput.type = 'checkbox';
        preserveTagsInput.id = 'preserveTagsInput';
        preserveTagsInput.checked = config.preserveExistingTags;

        const preserveTagsLabel = document.createElement('label');
        preserveTagsLabel.textContent = 'Preserve existing tags when auto-tagging';
        preserveTagsLabel.htmlFor = 'preserveTagsInput';

        preserveTagsContainer.appendChild(preserveTagsInput);
        preserveTagsContainer.appendChild(preserveTagsLabel);

        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'display: flex; gap: 10px; justify-content: flex-end;';

        const saveButton = document.createElement('button');
        saveButton.textContent = 'Save';
        saveButton.type = 'submit';

        const cancelButton = document.createElement('button');
        cancelButton.textContent = 'Cancel';

        form.appendChild(endpointLabel);
        form.appendChild(endpointInput);
        form.appendChild(blacklistContainer);
        form.appendChild(autoTagsContainer);
        form.appendChild(preserveTagsContainer);
        buttonContainer.appendChild(cancelButton);
        buttonContainer.appendChild(saveButton);
        form.appendChild(buttonContainer);
        dialog.appendChild(form);

        document.body.appendChild(dialog);
        dialog.showModal();

        setupTagAutocomplete(blacklistInput);
        setupTagAutocomplete(autoTagsInput);

        form.onsubmit = e => {
            e.preventDefault();
            GM_setValue('localEndpoint', endpointInput.value);
            GM_setValue('tagBlacklist', blacklistInput.value);
            GM_setValue('autoTags', autoTagsInput.value);
            GM_setValue('preserveExistingTags', preserveTagsInput.checked);
            checkConnection();
            dialog.close();
            dialog.remove();

            const textarea = document.getElementById("post_tags");
            if (textarea && autoTagsInput.value.trim()) {
                applyAutoTags(textarea);
            }
        };

        cancelButton.onclick = () => {
            dialog.close();
            dialog.remove();
        };
    };

    const addControls = () => {
        let textarea = document.getElementById("post_tags");
        if (!textarea || !textarea.parentElement) return;

        const controlsContainer = document.createElement("div");
        controlsContainer.style.cssText = "display: flex; align-items: center; gap: 10px; margin-bottom: 10px;";

        const button = document.createElement("button");
        button.textContent = "Connect";
        button.classList.add("toggle-button", "ai-tag-button");
        button.title = "Using Local JTP Pilot²";

        const confidenceContainer = document.createElement("div");
        confidenceContainer.style.cssText = "display: flex; align-items: center;";

        const confidenceLabel = document.createElement("label");
        confidenceLabel.textContent = "Confidence:";
        confidenceLabel.style.marginRight = "5px";

        const confidenceInput = document.createElement("input");
        confidenceInput.type = "number";
        confidenceInput.step = "0.05";
        confidenceInput.min = "0.1";
        confidenceInput.max = "1";
        confidenceInput.classList.add("ai-confidence-input");
        confidenceInput.value = getConfig().confidence.toFixed(2);
        confidenceInput.style.width = "60px";
        confidenceInput.addEventListener("change", e => updateConfidence(e.target.value));

        const warningText = document.createElement("span");
        warningText.classList.add("ai-warning-text");
        warningText.textContent = "⚠️ Not connected to JTP Pilot";
        warningText.style.color = "red";

        const throbber = document.createElement("div");
        throbber.textContent = "⏳ Processing...";
        throbber.style.cssText = "position: absolute; background: rgba(0, 0, 0, 0.5); color: white; padding: 2vh; border-radius: 1vh; z-index: 1000; margin-top: 1%; margin-left: 15%;";

        confidenceContainer.appendChild(confidenceLabel);
        confidenceContainer.appendChild(confidenceInput);

        button.onclick = () => {
            if (button.textContent === "Connect") {
                checkConnection();
            } else {
                processImage(button, textarea, throbber);
            }
        };

        controlsContainer.appendChild(button);
        controlsContainer.appendChild(confidenceContainer);
        controlsContainer.appendChild(warningText);

        textarea.parentElement.insertBefore(controlsContainer, textarea);

        if (connectionCheckInterval) {
            clearInterval(connectionCheckInterval);
        }
        connectionCheckInterval = setInterval(checkConnection, 10000);

        checkConnection();
        applyAutoTags(textarea);
    };

    GM_registerMenuCommand('Configure Local Tagger Endpoint', showConfigUI);
    window.addEventListener("load", addControls);
})();
