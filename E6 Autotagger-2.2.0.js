// ==UserScript==
// @name         E6 Autotagger 2.2
// @version      2.2
// @author       Jax (Slop_Dragon)
// @description  Adds a button that automatically tags e621 images using local AI
// @icon         https://www.google.com/s2/favicons?domain=e621.net
// @match        https://e621.net/uploads/new
// @match        https://e926.net/uploads/new
// @match        https://e6ai.net/uploads/new
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
        tagString = typeof tagString === 'string' ? tagString : '';

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

        const configSlider = document.getElementById('confidence-slider');
        if (configSlider) configSlider.value = value;

        const configLabel = document.getElementById('confidence-label');
        if (configLabel) configLabel.textContent = `Confidence Threshold: ${value}`;

        console.log(`Confidence updated to: ${value}`);
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
            timeout: 3000,
            onload: response => {
                try {
                    JSON.parse(response.responseText);
                    lastSuccessfulCheck = Date.now();
                    setConnectionState(true);
                } catch (e) {
                    if (Date.now() - lastSuccessfulCheck > 5000) {
                        setConnectionState(false);
                    }
                }
            },
            onerror: () => {
                if (Date.now() - lastSuccessfulCheck > 5000) {
                    setConnectionState(false);
                }
            },
            ontimeout: () => {
                if (Date.now() - lastSuccessfulCheck > 5000) {
                    setConnectionState(false);
                }
            }
        });
    };

    const processImage = (button, textarea, throbber) => {
        const config = getConfig();

        let img = getElement(selectors.uploadPreview);

        if (!img) {
            img = document.querySelector('#image') ||
                document.querySelector('.original-file-unchanged') ||
                document.querySelector('#image-container img') ||
                document.querySelector('img[id^="image-"]') ||
                document.querySelector('.image-container img') ||
                document.querySelector('#preview img');
        }

        if (!img) {
            alert("Could not find the image preview. Please try again.");
            return;
        }

        button.disabled = true;
        button.style.opacity = "0.5";
        textarea.parentElement.insertBefore(throbber, textarea);

        const handleAIResponse = aiResponse => {
            try {
                const json = JSON.parse(aiResponse.responseText);
                if (textarea && json.data && json.data[0]) {
                    const tagString = typeof json.data[0] === 'string' ? json.data[0] : '';
                    const existingTags = config.preserveExistingTags ? textarea.value : '';

                    textarea.value = formatTags(tagString, existingTags);

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

    const addAutocompleteToTextarea = (textarea, containerDiv) => {
        const suggestionsContainer = document.createElement('div');
        suggestionsContainer.className = 'tag-suggestions-container';
        suggestionsContainer.style.cssText = 'position: absolute; max-height: 200px; width: 100%; overflow-y: auto; background-color: #333; border: 1px solid #666; border-radius: 4px; z-index: 1000; display: none;';
        containerDiv.appendChild(suggestionsContainer);

        const fetchSuggestions = (term) => {
            if (term.length < 3) {
                suggestionsContainer.style.display = 'none';
                return;
            }

            GM_xmlhttpRequest({
                method: "GET",
                url: `https://e621.net/tags/autocomplete.json?search[name_matches]=${encodeURIComponent(term)}&expiry=7`,
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                onload: (response) => {
                    try {
                        const tags = JSON.parse(response.responseText);
                        suggestionsContainer.innerHTML = '';

                        if (tags.length === 0) {
                            suggestionsContainer.style.display = 'none';
                            return;
                        }

                        tags.forEach(tag => {
                            const suggestion = document.createElement('div');
                            suggestion.className = 'tag-suggestion';
                            suggestion.textContent = tag.name.replace(/_/g, ' ');
                            suggestion.style.cssText = 'padding: 5px 10px; cursor: pointer; border-bottom: 1px solid #555;';

                            const categoryColors = {
                                0: '#b4c7d9', // general
                                1: '#ed5d1f', // artist/director
                                3: '#d0d', // copyright/franchise
                                4: '#0f0', // character
                                5: '#ed5881', // species
                                6: '#ff3f3f', // invalid
                                7: '#fff' // meta
                            };

                            suggestion.style.color = categoryColors[tag.category] || '#fff';

                            const countLabel = document.createElement('span');
                            countLabel.textContent = tag.post_count.toLocaleString();
                            countLabel.style.cssText = 'float: right; opacity: 0.7;';
                            suggestion.appendChild(countLabel);

                            suggestion.addEventListener('click', () => {
                                addTagToTextarea(textarea, tag.name);
                                suggestionsContainer.style.display = 'none';
                            });

                            suggestion.addEventListener('mouseenter', () => {
                                Array.from(suggestionsContainer.querySelectorAll('.tag-suggestion')).forEach(s => {
                                    s.classList.remove('active');
                                });
                                suggestion.classList.add('active');
                            });

                            suggestionsContainer.appendChild(suggestion);
                        });

                        const style = document.createElement('style');
                        style.textContent = '.tag-suggestion.active { background-color: #444; }';
                        document.head.appendChild(style);

                        const rect = textarea.getBoundingClientRect();
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
        };

        const addTagToTextarea = (textarea, tagName) => {
            const cursorPosition = textarea.selectionStart;
            const textBeforeCursor = textarea.value.substring(0, cursorPosition);
            const textAfterCursor = textarea.value.substring(cursorPosition);

            const lastCommaPos = textBeforeCursor.lastIndexOf(',');
            const startPos = lastCommaPos === -1 ? 0 : lastCommaPos + 1;

            const newTextBeforeCursor = textBeforeCursor.substring(0, startPos) +
                  (startPos > 0 && textBeforeCursor[startPos] !== ' ' ? ' ' : '') +
                  tagName;

            const newValue = newTextBeforeCursor +
                  (textAfterCursor.trim() !== '' && !textAfterCursor.trim().startsWith(',') ? ', ' : '') +
                  textAfterCursor;

            textarea.value = newValue;

            const newCursorPos = newTextBeforeCursor.length + (textAfterCursor.trim() !== '' ? 2 : 0);
            textarea.setSelectionRange(newCursorPos, newCursorPos);
            textarea.focus();
        };

        let debounceTimer;
        textarea.addEventListener('input', (e) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                const cursorPosition = textarea.selectionStart;
                const textBeforeCursor = textarea.value.substring(0, cursorPosition);

                const match = textBeforeCursor.match(/[^,]*$/);
                if (match) {
                    const currentTag = match[0].trim();
                    fetchSuggestions(currentTag);
                }
            }, 300);
        });

        document.addEventListener('click', (e) => {
            if (!suggestionsContainer.contains(e.target) && e.target !== textarea) {
                suggestionsContainer.style.display = 'none';
            }
        });

        textarea.addEventListener('keydown', (e) => {
            if (!suggestionsContainer.style.display || suggestionsContainer.style.display === 'none') {
                return;
            }

            const suggestions = suggestionsContainer.querySelectorAll('.tag-suggestion');
            const activeIndex = Array.from(suggestions).findIndex(s => s.classList.contains('active'));

            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    navigateSuggestions(suggestions, activeIndex, 1);
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    navigateSuggestions(suggestions, activeIndex, -1);
                    break;
                case 'Enter': {
                    e.preventDefault();
                    const activeElement = suggestionsContainer.querySelector('.tag-suggestion.active');
                    if (activeElement) {
                        activeElement.click();
                    }
                    break;
                }
                case 'Escape':
                    suggestionsContainer.style.display = 'none';
                    break;
            }
        });

        const navigateSuggestions = (suggestions, currentIndex, direction) => {
            if (currentIndex >= 0) {
                suggestions[currentIndex].classList.remove('active');
            }

            let newIndex = currentIndex + direction;
            if (newIndex < 0) newIndex = suggestions.length - 1;
            if (newIndex >= suggestions.length) newIndex = 0;

            suggestions[newIndex].classList.add('active');
            suggestions[newIndex].scrollIntoView({ block: 'nearest' });
        };
    };

    const showConfigUI = () => {
        const existingDialog = document.getElementById('e6-autotagger-config');
        if (existingDialog) {
            existingDialog.remove();
        }

        const dialog = document.createElement('dialog');
        dialog.id = 'e6-autotagger-config';
        dialog.style.cssText = 'padding: 20px; border-radius: 8px; background-color: #2a2a2a; color: #fff; border: 1px solid #666; min-width: 400px; max-width: 600px;';

        const title = document.createElement('h2');
        title.textContent = 'E6 Autotagger Configuration';
        title.style.cssText = 'margin-top: 0; text-align: center;';

        const container = document.createElement('div');
        container.style.cssText = 'display: flex; flex-direction: column; gap: 15px;';

        const currentConfig = getConfig();
        let displayEndpoint = currentConfig.localEndpoint;
        if (displayEndpoint.endsWith('/api/predict')) {
            displayEndpoint = displayEndpoint.substring(0, displayEndpoint.length - 12);
        }

        const endpointLabel = document.createElement('label');
        endpointLabel.textContent = 'Local AI Endpoint URL:';

        const endpointInput = document.createElement('input');
        endpointInput.type = 'text';
        endpointInput.value = displayEndpoint;
        endpointInput.style.cssText = 'width: 100%; padding: 8px; background-color: #333; color: #fff; border: 1px solid #666; border-radius: 4px; margin-top: 5px;';
        endpointInput.placeholder = 'http://127.0.0.1:7860';

        const endpointContainer = document.createElement('div');
        endpointContainer.appendChild(endpointLabel);
        endpointContainer.appendChild(endpointInput);

        const confidenceLabel = document.createElement('label');
        confidenceLabel.textContent = `Confidence Threshold: ${currentConfig.confidence}`;
        confidenceLabel.id = 'confidence-label';

        const confidenceInput = document.createElement('input');
        confidenceInput.type = 'range';
        confidenceInput.id = 'confidence-slider';
        confidenceInput.min = '0.1';
        confidenceInput.max = '1';
        confidenceInput.step = '0.05';
        confidenceInput.value = currentConfig.confidence;
        confidenceInput.style.cssText = 'width: 100%; margin-top: 5px;';

        confidenceInput.addEventListener('input', () => {
            const value = parseFloat(confidenceInput.value);
            confidenceLabel.textContent = `Confidence Threshold: ${value}`;
            updateConfidence(value);
        });

        const confidenceContainer = document.createElement('div');
        confidenceContainer.appendChild(confidenceLabel);
        confidenceContainer.appendChild(confidenceInput);

        const blacklistLabel = document.createElement('label');
        blacklistLabel.textContent = 'Tag Blacklist:';

        const blacklistContainer = document.createElement('div');
        blacklistContainer.style.position = 'relative';
        blacklistContainer.appendChild(blacklistLabel);

        const blacklistInput = document.createElement('textarea');
        blacklistInput.value = currentConfig.tagBlacklist;
        blacklistInput.style.cssText = 'width: 100%; height: 100px; padding: 8px; background-color: #333; color: #fff; border: 1px solid #666; border-radius: 4px; margin-top: 5px;';
        blacklistInput.placeholder = 'Tags you do not want (comma separated)';
        blacklistContainer.appendChild(blacklistInput);

        addAutocompleteToTextarea(blacklistInput, blacklistContainer);
        const autoTagsLabel = document.createElement('label');
        autoTagsLabel.textContent = 'Auto Tags:';

        const autoTagsContainer = document.createElement('div');
        autoTagsContainer.style.position = 'relative';
        autoTagsContainer.appendChild(autoTagsLabel);

        const autoTagsInput = document.createElement('textarea');
        autoTagsInput.value = currentConfig.autoTags;
        autoTagsInput.style.cssText = 'width: 100%; height: 100px; padding: 8px; background-color: #333; color: #fff; border: 1px solid #666; border-radius: 4px; margin-top: 5px;';
        autoTagsInput.placeholder = 'Tags to automatically add (comma separated)';
        autoTagsContainer.appendChild(autoTagsInput);

        addAutocompleteToTextarea(autoTagsInput, autoTagsContainer);

        const preserveTagsContainer = document.createElement('div');
        preserveTagsContainer.style.cssText = 'display: flex; align-items: center; gap: 10px; margin-top: 5px;';

        const preserveTagsInput = document.createElement('input');
        preserveTagsInput.type = 'checkbox';
        preserveTagsInput.checked = currentConfig.preserveExistingTags;
        preserveTagsInput.style.cssText = 'width: 18px; height: 18px;';

        const preserveTagsLabel = document.createElement('label');
        preserveTagsLabel.textContent = 'Preserve existing tags when auto-tagging';
        preserveTagsLabel.style.marginLeft = '5px';

        preserveTagsContainer.appendChild(preserveTagsInput);
        preserveTagsContainer.appendChild(preserveTagsLabel);

        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;';

        const cancelButton = document.createElement('button');
        cancelButton.textContent = 'Cancel';
        cancelButton.style.cssText = 'padding: 8px 16px; border: none; border-radius: 4px; background-color: #555; color: #fff; cursor: pointer;';

        const saveButton = document.createElement('button');
        saveButton.textContent = 'Save';
        saveButton.style.cssText = 'padding: 8px 16px; border: none; border-radius: 4px; background-color: #4a6; color: #fff; cursor: pointer;';

        buttonContainer.appendChild(cancelButton);
        buttonContainer.appendChild(saveButton);

        const statusMessage = document.createElement('div');
        statusMessage.style.cssText = 'margin-top: 10px; padding: 8px; border-radius: 4px; text-align: center; display: none;';

        container.appendChild(endpointContainer);
        container.appendChild(confidenceContainer);
        container.appendChild(blacklistContainer);
        container.appendChild(autoTagsContainer);
        container.appendChild(preserveTagsContainer);

        dialog.appendChild(title);
        dialog.appendChild(container);
        dialog.appendChild(buttonContainer);
        dialog.appendChild(statusMessage);

        document.body.appendChild(dialog);
        dialog.showModal();

        const showStatus = (message, isError = false) => {
            console.log("Status message:", message, "isError:", isError);
            statusMessage.textContent = message;
            statusMessage.style.display = 'block';
            statusMessage.style.backgroundColor = isError ? '#a33' : '#3a6';
            statusMessage.style.color = '#fff';
        };

        const saveSettings = () => {
            try {
                let endpoint = endpointInput.value.trim();
                const confidence = parseFloat(confidenceInput.value);
                const blacklist = blacklistInput.value.trim();
                const autoTags = autoTagsInput.value.trim();
                const preserveExisting = preserveTagsInput.checked;

                console.log("Saving settings:", {
                    endpoint,
                    confidence,
                    blacklist,
                    autoTags,
                    preserveExisting
                });

                if (!endpoint) {
                    showStatus('Endpoint URL cannot be empty', true);
                    return false;
                }

                if (!endpoint.endsWith('/api/predict')) {
                    endpoint = endpoint.replace(/\/$/, '') + '/api/predict';
                }

                GM_setValue('localEndpoint', endpoint);
                GM_setValue('confidence', confidence);
                GM_setValue('tagBlacklist', blacklist);
                GM_setValue('autoTags', autoTags);
                GM_setValue('preserveExistingTags', preserveExisting);

                console.log("Settings saved successfully");

                checkConnection();

                const textarea = getTagTextarea();
                if (textarea && autoTags) {
                    applyAutoTags(textarea);
                }

                return true;
            } catch (error) {
                console.error("Error saving settings:", error);
                showStatus('Error: ' + error.message, true);
                return false;
            }
        };

        saveButton.onclick = () => {
            const saved = saveSettings();
            if (saved) {
                showStatus('Settings saved successfully!');

                saveButton.textContent = 'Close';
                saveButton.onclick = () => {
                    dialog.remove();
                };
            }
        };

        cancelButton.onclick = () => {
            dialog.remove();
        };
    };

    const getTagTextarea = () => {
        let textarea = document.getElementById("post_tags");

        if (!textarea) {
            textarea = document.getElementById("post_tag_string");
        }

        if (!textarea) {
            textarea = document.querySelector("textarea.tag-textarea[name='post[tag_string]']");
        }

        return textarea;
    };

    const addControls = () => {
        let textarea = getTagTextarea();
        if (!textarea) {
            console.log("No tag textarea found");
            return;
        }

        if (document.querySelector('.ai-tag-button')) {
            console.log("Controls already added");
            return;
        }

        console.log("Found textarea:", textarea.id);

        const controlsContainer = document.createElement("div");
        controlsContainer.style.cssText = "display: flex; align-items: center; gap: 10px; margin-bottom: 10px;";
        controlsContainer.classList.add('ai-controls-container');

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
        confidenceInput.addEventListener("change", e => {
            const newValue = parseFloat(e.target.value);
            updateConfidence(newValue);

            button.disabled = false;
            button.style.opacity = "1";

            console.log(`Tag page confidence updated to: ${newValue}`);
        });

        const warningText = document.createElement("span");
        warningText.classList.add("ai-warning-text");
        warningText.textContent = "⚠️ Not connected to JTP Pilot";
        warningText.style.color = "red";

        confidenceContainer.appendChild(confidenceLabel);
        confidenceContainer.appendChild(confidenceInput);

        button.onclick = () => {
            if (button.textContent === "Connect") {
                checkConnection();
            } else {
                const throbber = document.createElement("div");
                throbber.textContent = "⏳ Processing...";
                throbber.style.cssText = "position: absolute; background: rgba(0, 0, 0, 0.5); color: white; padding: 2vh; border-radius: 1vh; z-index: 1000; margin-top: 1%; margin-left: 15%;";
                processImage(button, textarea, throbber);
            }
        };

        controlsContainer.appendChild(button);
        controlsContainer.appendChild(confidenceContainer);
        controlsContainer.appendChild(warningText);

        if (textarea.id === "post_tag_string") {
            const tagsContainer = document.getElementById("tags-container");

            if (tagsContainer) {
                const headerElement = tagsContainer.querySelector(".header");
                if (headerElement) {
                    headerElement.parentNode.insertBefore(controlsContainer, headerElement.nextSibling);
                    console.log("Inserted controls after header");
                } else {
                    const tagStringEditor = document.getElementById("tag-string-editor");
                    if (tagStringEditor) {
                        tagsContainer.insertBefore(controlsContainer, tagStringEditor);
                        console.log("Inserted controls before tag-string-editor");
                    } else {
                        tagsContainer.insertBefore(controlsContainer, tagsContainer.firstChild);
                        console.log("Inserted controls at the top of tags-container");
                    }
                }
            } else {
                const textareaParent = textarea.closest("div");
                if (textareaParent && textareaParent.parentNode) {
                    textareaParent.parentNode.insertBefore(controlsContainer, textareaParent);
                    console.log("Inserted controls before textarea's closest div");
                } else {
                    textarea.parentElement.insertBefore(controlsContainer, textarea);
                    console.log("Inserted controls directly before textarea");
                }
            }
        } else {
            textarea.parentElement.insertBefore(controlsContainer, textarea);
            console.log("Inserted controls on upload page");
        }

        if (connectionCheckInterval) {
            clearInterval(connectionCheckInterval);
        }
        connectionCheckInterval = setInterval(checkConnection, 5000);

        checkConnection();
        applyAutoTags(textarea);
    };

    const init = () => {
        console.log("E6 Autotagger initializing...");

        addControls();

        setTimeout(checkConnection, 100);
    };

    GM_registerMenuCommand('Configure Local Tagger Endpoint', showConfigUI);

    if (document.readyState === "complete" || document.readyState === "interactive") {
        setTimeout(init, 1);
    } else {
        document.addEventListener("DOMContentLoaded", init);
        window.addEventListener("load", init);
    }

    const checkForEditPage = () => {
        const currentUrl = window.location.href;
        if (currentUrl.includes('/posts/') && document.getElementById("post_tag_string")) {
            console.log("Detected edit page via URL check, initializing...");
            init();
        }
    };

    setInterval(checkForEditPage, 2000);

    window.addEventListener("load", addControls);
})();
