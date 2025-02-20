// ==UserScript==
// @name         E6 Autotagger
// @namespace    https://MeusArtis.ca
// @version      2.0.1
// @author       Jax (Slop_Dragon) (Original by Meus Artis)
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
// ==/UserScript==

(function() {
    const DEFAULT_CONFIG = {
        localEndpoint: 'http://127.0.0.1:7860/api/predict',
        confidence: 0.25
    };

    function getConfig() {
        return {
            localEndpoint: GM_getValue('localEndpoint', DEFAULT_CONFIG.localEndpoint),
            confidence: GM_getValue('confidence', DEFAULT_CONFIG.confidence)
        };
    }

    function formatTags(tagString) {
        const tags = tagString.split(',').map(tag => tag.trim());

        return tags.map(tag => {
            return tag.replace(/\s+/g, '_');
        }).join(' ');
    }

    function showConfigUI() {
        const config = getConfig();
        const endpoint = prompt('Enter local AI endpoint URL:', config.localEndpoint);
        if (endpoint !== null) {
            GM_setValue('localEndpoint', endpoint);
            checkConnection();
        }
    }

    GM_registerMenuCommand('Configure Local Tagger Endpoint', showConfigUI);

    function updateConfidence(value) {
        value = Math.max(0.1, Math.min(1, parseFloat(value) || 0.25));
        GM_setValue('confidence', value);
        const confidenceInput = document.querySelector('.ai-confidence-input');
        if (confidenceInput) {
            confidenceInput.value = value.toFixed(2);
        }
    }

    function setDisconnectedState() {
        const button = document.querySelector('.ai-tag-button');
        const warningText = document.querySelector('.ai-warning-text');

        if (button && warningText) {
            button.textContent = "Connect";
            button.disabled = false;
            button.style.opacity = "1";
            button.style.cursor = "pointer";
            warningText.textContent = "⚠️ Not connected to JTP Pilot";
            warningText.style.color = "red";
        }
    }

    function setConnectedState() {
        const button = document.querySelector('.ai-tag-button');
        const warningText = document.querySelector('.ai-warning-text');

        if (button && warningText) {
            button.textContent = "Auto Tag";
            button.disabled = false;
            button.style.opacity = "1";
            button.style.cursor = "pointer";
            warningText.textContent = "⚠️ Manually review tags";
            warningText.style.color = "yellow";
        }
    }

    let connectionCheckInterval;
    let lastSuccessfulCheck = 0;

    function checkConnection() {
        const config = getConfig();
        const button = document.querySelector('.ai-tag-button');
        const warningText = document.querySelector('.ai-warning-text');

        if (!button || !warningText) return;

        GM_xmlhttpRequest({
            method: "POST",
            url: config.localEndpoint,
            headers: {
                "Content-Type": "application/json"
            },
            data: JSON.stringify({
                data: ["", config.confidence],
                fn_index: 0
            }),
            timeout: 5000,
            onload: function(response) {
                try {
                    JSON.parse(response.responseText);
                    lastSuccessfulCheck = Date.now();
                    setConnectedState();
                } catch (e) {
                    if (Date.now() - lastSuccessfulCheck > 10000) {
                        setDisconnectedState();
                    }
                }
            },
            onerror: function() {
                if (Date.now() - lastSuccessfulCheck > 10000) {
                    setDisconnectedState();
                }
            },
            ontimeout: function() {
                if (Date.now() - lastSuccessfulCheck > 10000) {
                    setDisconnectedState();
                }
            }
        });
    }

    function processImage(button, textarea, throbber) {
        const config = getConfig();
        let img = document.querySelector(".upload_preview_img");
        if (!img) {
            console.error("No image found!");
            return;
        }

        button.disabled = true;
        button.style.opacity = "0.5";
        textarea.parentElement.insertBefore(throbber, textarea);

        GM_xmlhttpRequest({
            method: "GET",
            url: img.src,
            responseType: "blob",
            onload: function(response) {
                const blob = response.response;
                const reader = new FileReader();
                reader.onloadend = function() {
                    const base64String = reader.result;

                    const requestBody = {
                        data: [base64String, config.confidence],
                        fn_index: 0
                    };

                    GM_xmlhttpRequest({
                        method: "POST",
                        url: config.localEndpoint,
                        headers: {
                            "Content-Type": "application/json",
                            "Accept": "application/json"
                        },
                        data: JSON.stringify(requestBody),
                        onload: function(aiResponse) {
                            try {
                                const json = JSON.parse(aiResponse.responseText);
                                if (textarea && json.data && json.data[0]) {
                                    // Format the tags before setting the textarea value
                                    textarea.value = formatTags(json.data[0]);
                                    lastSuccessfulCheck = Date.now();
                                    setConnectedState();
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
                        },
                        onerror: function(err) {
                            alert("Error connecting to AI: " + err.error);
                            checkConnection();
                            button.disabled = false;
                            button.style.opacity = "1";
                            throbber.remove();
                        }
                    });
                };
                reader.readAsDataURL(blob);
            },
            onerror: function(err) {
                alert("Error fetching image: " + err.error);
                button.disabled = false;
                button.style.opacity = "1";
                throbber.remove();
            }
        });
    }

    function addControls() {
        let textarea = document.getElementById("post_tags");
        if (!textarea || !textarea.parentElement) return;

        let controlsContainer = document.createElement("div");
        controlsContainer.style.display = "flex";
        controlsContainer.style.alignItems = "center";
        controlsContainer.style.gap = "10px";
        controlsContainer.style.marginBottom = "10px";

        let button = document.createElement("button");
        button.textContent = "Connect";
        button.classList.add("toggle-button", "ai-tag-button");
        button.title = "Using Local JTP Pilot²";

        let confidenceContainer = document.createElement("div");
        confidenceContainer.style.display = "flex";
        confidenceContainer.style.alignItems = "center";

        let confidenceLabel = document.createElement("label");
        confidenceLabel.textContent = "Confidence:";
        confidenceLabel.style.marginRight = "5px";

        let confidenceInput = document.createElement("input");
        confidenceInput.type = "number";
        confidenceInput.step = "0.05";
        confidenceInput.min = "0.1";
        confidenceInput.max = "1";
        confidenceInput.classList.add("ai-confidence-input");
        confidenceInput.value = getConfig().confidence.toFixed(2);
        confidenceInput.style.width = "60px";
        confidenceInput.addEventListener("change", (e) => updateConfidence(e.target.value));

        confidenceContainer.appendChild(confidenceLabel);
        confidenceContainer.appendChild(confidenceInput);

        let warningText = document.createElement("span");
        warningText.classList.add("ai-warning-text");
        warningText.textContent = "⚠️ Not connected to JTP Pilot";
        warningText.style.color = "red";

        let throbber = document.createElement("div");
        throbber.textContent = "⏳ Processing...";
        throbber.style.position = "absolute";
        throbber.style.background = "rgba(0, 0, 0, 0.5)";
        throbber.style.color = "white";
        throbber.style.padding = "2vh";
        throbber.style.borderRadius = "1vh";
        throbber.style.zIndex = "1000";
        throbber.style.marginTop = "1%";
        throbber.style.marginLeft = "15%";

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
    }

    window.addEventListener("load", addControls);
})();
