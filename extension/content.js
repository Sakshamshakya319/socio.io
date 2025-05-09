// Global state
let isEnabled = true;
let processingQueue = [];
let currentlyProcessing = false;
let textElementsProcessed = new Set();
let imageElementsProcessed = new Set();
let encryptedElements = new Map();

// Configuration
const API_BASE_URL = 'http://127.0.0.1:5000';
const TEXT_SELECTORS = 'p, h1, h2, h3, h4, h5, h6, span, div:not(:has(*)), a:not(:has(*))';
const IMAGE_SELECTORS = 'img';
const EXCLUSION_CLASS = 'socioio-processed';
const INDICATOR_CLASS = 'socioio-text-indicator';
const BATCH_SIZE = 5;
const BATCH_DELAY = 300;
const DEBOUNCE_DELAY = 500;

// Debug logging
function debug(message, obj = null) {
    const timestamp = new Date().toISOString();
    if (obj) {
        console.log(`[Socio.io ${timestamp}]`, message, obj);
    } else {
        console.log(`[Socio.io ${timestamp}]`, message);
    }
    
    // Add visual debugging for image processing (only in development)
    if (message.includes("image") && window.location.href.includes("test.html")) {
        const debugElement = document.getElementById('socioio-debug') || createDebugElement();
        const logEntry = document.createElement('div');
        logEntry.className = 'debug-log-entry';
        logEntry.textContent = `${timestamp.split('T')[1].split('.')[0]} - ${message}`;
        debugElement.appendChild(logEntry);
        
        // Keep only the last 10 messages
        const entries = debugElement.querySelectorAll('.debug-log-entry');
        if (entries.length > 10) {
            debugElement.removeChild(entries[0]);
        }
    }
}

// Create debug element for visual debugging
function createDebugElement() {
    const debugElement = document.createElement('div');
    debugElement.id = 'socioio-debug';
    debugElement.style.cssText = `
        position: fixed;
        bottom: 10px;
        right: 10px;
        width: 300px;
        max-height: 200px;
        overflow-y: auto;
        background-color: rgba(0, 0, 0, 0.8);
        color: #00ff00;
        font-family: monospace;
        font-size: 12px;
        padding: 10px;
        border-radius: 5px;
        z-index: 9999;
    `;
    document.body.appendChild(debugElement);
    return debugElement;
}

// Initialize
debug("Content script loaded");
document.addEventListener('DOMContentLoaded', initialize);

// Store processed elements between page refreshes
function storeProcessedElements() {
    const processedTextElements = Array.from(textElementsProcessed).map(element => {
        return {
            selector: uniqueSelectorFor(element),
            processed: true
        };
    });
    
    const processedImageElements = Array.from(imageElementsProcessed).map(element => {
        return {
            src: element.src,
            processed: true
        };
    });
    
    const data = {
        textElements: processedTextElements,
        imageElements: processedImageElements,
        timestamp: Date.now()
    };
    
    // Store in sessionStorage to persist between refreshes but not between browser sessions
    sessionStorage.setItem('socioio_processed_elements', JSON.stringify(data));
}

// Load previously processed elements
function loadProcessedElements() {
    try {
        const dataString = sessionStorage.getItem('socioio_processed_elements');
        if (!dataString) return;
        
        const data = JSON.parse(dataString);
        
        // If older than 1 hour, clear it
        if (Date.now() - data.timestamp > 3600000) {
            sessionStorage.removeItem('socioio_processed_elements');
            return;
        }
        
        // Add text elements to Set
        if (data.textElements) {
            data.textElements.forEach(item => {
                try {
                    const element = document.querySelector(item.selector);
                    if (element && !element.classList.contains(EXCLUSION_CLASS)) {
                        element.classList.add(EXCLUSION_CLASS);
                    }
                } catch (e) {
                    // Selector might be invalid
                }
            });
        }
        
        // Add image elements to Set
        if (data.imageElements) {
            data.imageElements.forEach(item => {
                try {
                    const elements = document.querySelectorAll(`img[src="${item.src}"]`);
                    elements.forEach(element => {
                        if (!element.classList.contains(EXCLUSION_CLASS)) {
                            element.classList.add(EXCLUSION_CLASS);
                        }
                    });
                } catch (e) {
                    // Selector might be invalid
                }
            });
        }
    } catch (e) {
        debug("Error loading processed elements:", e);
    }
}

// Generate a unique CSS selector for an element
function uniqueSelectorFor(el) {
    if (!el) return null;
    if (el.id) return `#${el.id}`;
    
    // Get a path of selectors
    let path = [];
    while (el && el.nodeType === Node.ELEMENT_NODE) {
        let selector = el.nodeName.toLowerCase();
        if (el.id) {
            selector += `#${el.id}`;
            path.unshift(selector);
            break;
        } else {
            let siblings = Array.from(el.parentNode.childNodes)
                .filter(sibling => sibling.nodeType === Node.ELEMENT_NODE && sibling.nodeName === el.nodeName);
            
            if (siblings.length > 1) {
                let index = siblings.indexOf(el);
                selector += `:nth-child(${index + 1})`;
            }
            
            path.unshift(selector);
            el = el.parentNode;
        }
    }
    
    return path.join(' > ');
}

// Also try initializing immediately in case document already loaded
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    debug("Document already loaded, initializing immediately");
    initialize();
}

function initialize() {
    debug("Initializing content moderation");
    
    // Clear any existing notification indicators to prevent duplicates on page refresh
    clearNotifications();
    
    // Check for previously processed elements
    loadProcessedElements();
    
    // Check if protection is enabled
    chrome.storage.local.get(['enabled'], function(result) {
        isEnabled = result.enabled !== false;
        debug("Protection enabled:", isEnabled);
        
        if (isEnabled) {
            // Start the content moderation
            setupObserver();
            scanContentForModeration();
            
            // Add styles for tooltips and overlays
            injectStyles();
            
            // Send a test request to the backend to check connection
            fetch(`${API_BASE_URL}/api/status`)
                .then(response => response.json())
                .then(data => {
                    debug("Backend connection test successful:", data);
                })
                .catch(error => {
                    debug("Backend connection test failed:", error);
                });
                
            // Tell background script we're active
            notifyBackgroundScript();
        }
    });
    
    // Listen for messages from popup
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        debug("Received message:", message);
        
        if (message.action === 'toggleProtection') {
            isEnabled = message.enabled;
            debug("Protection toggled to:", isEnabled);
            
            if (isEnabled) {
                scanContentForModeration();
            } else {
                restoreOriginalContent();
            }
            sendResponse({status: "Protection toggled"});
        }
        
        if (message.action === 'getEncryptedContent') {
            // Find all encrypted content on the page
            const encryptedContent = Array.from(document.querySelectorAll('.socioio-encrypted'))
                .map(el => el.textContent)
                .join('\n');
            
            debug("Found encrypted content:", encryptedContent);    
            sendResponse({ encryptedContent });
        }
        
        if (message.action === 'applyRecoveredContent') {
            applyRecoveredContent(message.recoveredText);
            sendResponse({status: "Content recovered"});
        }
        
        if (message.action === 'checkStatus') {
            debug("Status check requested");
            sendResponse({
                status: "Content script active",
                isEnabled: isEnabled,
                elementsScanned: textElementsProcessed.size + imageElementsProcessed.size,
                queueLength: processingQueue.length
            });
        }
        
        return true;  // Indicates async response
    });
}

// Clear any existing notifications
function clearNotifications() {
    // Remove any existing notification indicators
    document.querySelectorAll('.' + INDICATOR_CLASS).forEach(el => {
        el.parentNode.removeChild(el);
    });
}

// Notify the background script we're active
function notifyBackgroundScript() {
    try {
        chrome.runtime.sendMessage({
            action: "contentScriptActive",
            url: window.location.href
        }, response => {
            debug("Background script response:", response || "No response");
        });
    } catch (e) {
        debug("Error sending message to background script:", e);
    }
}

// Set up mutation observer to detect DOM changes
function setupObserver() {
    debug("Setting up mutation observer");
    // Create an observer instance
    const observer = new MutationObserver(debounce(() => {
        if (isEnabled) {
            debug("DOM changed, scanning for new content");
            scanContentForModeration();
        }
    }, DEBOUNCE_DELAY));
    
    // Start observing
    observer.observe(document.body, { 
        childList: true, 
        subtree: true,
        attributes: false,
        characterData: false
    });
    debug("Mutation observer setup complete");
}

// Debounce function to prevent excessive processing
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// Scan the page for content that needs moderation
function scanContentForModeration() {
    if (!isEnabled) return;
    debug("Scanning page for content moderation");
    
    // Find all text elements that haven't been processed
    const textElements = document.querySelectorAll(TEXT_SELECTORS + ':not(.' + EXCLUSION_CLASS + ')');
    debug(`Found ${textElements.length} unprocessed text elements`);
    
    for (const element of textElements) {
        // Skip empty elements or those with only whitespace
        if (!element.textContent.trim()) continue;
        
        // Skip elements that have already been processed
        if (textElementsProcessed.has(element)) continue;
        
        // Add to processing queue
        processingQueue.push({
            type: 'text',
            element: element
        });
        
        // Mark as processed
        textElementsProcessed.add(element);
        element.classList.add(EXCLUSION_CLASS);
    }
    
    // Find all image elements that haven't been processed
    const imageElements = document.querySelectorAll(IMAGE_SELECTORS + ':not(.' + EXCLUSION_CLASS + ')');
    debug(`Found ${imageElements.length} unprocessed image elements`);
    
    for (const element of imageElements) {
        // Skip images without a source
        if (!element.src) continue;
        
        // Skip elements that have already been processed
        if (imageElementsProcessed.has(element)) continue;
        
        // Add to processing queue
        processingQueue.push({
            type: 'image',
            element: element
        });
        
        // Mark as processed
        imageElementsProcessed.add(element);
        element.classList.add(EXCLUSION_CLASS);
    }
    
    debug(`Processing queue now has ${processingQueue.length} items`);
    
    // Process the queue
    if (processingQueue.length > 0) {
        processNextBatch();
    }
    
    // Store processed elements for persistence
    storeProcessedElements();
}

// Process the next batch of elements in the queue
function processNextBatch() {
    if (currentlyProcessing || processingQueue.length === 0 || !isEnabled) {
        debug(`Not processing batch: currentlyProcessing=${currentlyProcessing}, queueLength=${processingQueue.length}, isEnabled=${isEnabled}`);
        return;
    }
    
    currentlyProcessing = true;
    
    // Process a batch of elements
    const batch = processingQueue.splice(0, BATCH_SIZE);
    debug(`Processing batch of ${batch.length} elements`);
    
    const promises = batch.map(processElement);
    
    // When all elements in the batch are processed
    Promise.allSettled(promises).then(results => {
        debug("Batch processing complete", results);
        currentlyProcessing = false;
        
        // If there are more elements in the queue, process the next batch after a delay
        if (processingQueue.length > 0) {
            debug(`Scheduling next batch of ${Math.min(BATCH_SIZE, processingQueue.length)} elements in ${BATCH_DELAY}ms`);
            setTimeout(processNextBatch, BATCH_DELAY);
        }
    });
}

// Process a single element
function processElement(item) {
    return new Promise((resolve, reject) => {
        try {
            debug(`Processing ${item.type} element`, item.element);
            if (item.type === 'text') {
                processTextElement(item.element)
                    .then(result => {
                        debug("Text processing complete", result);
                        resolve(result);
                    })
                    .catch(error => {
                        debug("Text processing error", error);
                        reject(error);
                    });
            } else if (item.type === 'image') {
                try {
                    // Call the synchronous processImageElement function
                    const result = processImageElement(item.element);
                    debug("Image processing complete", result);
                    resolve(result);
                } catch (error) {
                    debug("Image processing error", error);
                    reject(error);
                }
            } else {
                debug(`Unknown element type: ${item.type}`);
                resolve();
            }
        } catch (error) {
            debug('Error processing element:', error);
            resolve();  // Resolve anyway to continue with other elements
        }
    });
}

// Process a text element with client-side backup detection
async function processTextElement(element) {
    try {
        // Skip if the element has been removed from the DOM
        if (!element.isConnected) {
            debug("Element no longer connected to DOM");
            return { status: "skipped", reason: "element_not_connected" };
        }
        
        const text = element.textContent.trim();
        if (!text) {
            debug("Element has no text content");
            return { status: "skipped", reason: "no_text" };
        }
        
        debug(`Processing text: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);
        
        // Client-side detection for backup - detect only severe profanity
        const lowerText = text.toLowerCase();
        
        // Only filter the most explicit profanity
        const profanityWords = ["fuck", "fucker", "fucking"];
        
        // Only filter explicit hate speech
        const hateWords = [];  // Disabled for now to reduce false positives
        
        // Check for exact word matches, not just substrings
        let isProfanity = profanityWords.some(word => {
            // Check for word boundaries to avoid false positives
            const regex = new RegExp(`\\b${word}\\b`, 'i');
            return regex.test(lowerText);
        });
        
        let isHateSpeech = false; // Disabled for now
        
        // Only filter if the text is short - don't filter long paragraphs
        if (text.length > 200) {
            isProfanity = false;
            isHateSpeech = false;
        }
        
        // If we detect something locally, handle it (this is backup in case backend fails)
        if (isProfanity || isHateSpeech) {
            debug("Client-side detected problematic content");
            
            // Create a more user-friendly filtered text display
            let filteredText;
            
            // Different filtering methods based on content length
            if (text.length < 30) {
                // For short text, use a generic message
                filteredText = "[Content filtered by Socio.io]";
            } else if (text.length < 100) {
                // For medium text, show beginning and end with filtered middle
                const start = text.substring(0, 10);
                const end = text.substring(text.length - 10);
                filteredText = `${start}... [Content filtered by Socio.io] ...${end}`;
            } else {
                // For long text, show a paragraph summary
                const firstSentence = text.split('.')[0];
                const preview = firstSentence.length > 50 ? firstSentence.substring(0, 50) + "..." : firstSentence;
                filteredText = `${preview}\n\n[Additional content filtered by Socio.io - Click the indicator to view]`;
            }
            
            // Apply the filtered text
            element.textContent = filteredText;
            
            // Add a special class to identify filtered elements
            element.classList.add('socioio-filtered-text');
            
            // Create reasons array
            const reasons = [isProfanity ? "Profanity detected" : "", isHateSpeech ? "Hate speech detected" : ""]
                .filter(reason => reason);
                
            // Add visual indicator
            addModerationIndicator(element, "remove", reasons);
            
            // Save to filter history
            saveFilterHistory('text', text, reasons);
            
            // Update stats
            updateStats('text');
            
            return { status: "filtered", action: "remove", reasons: ["Client-side detection"] };
        }
        
        // Send to backend for analysis
        try {
            debug("Sending text to backend");
            
            const response = await fetch(`${API_BASE_URL}/analyze_text`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    text: text,
                    url: window.location.href
                })
            });
            
            // Parse the response
            const data = await response.json();
            
            debug("Text analysis response:", data);
            
            if (data.error) {
                debug('Error analyzing text:', data.error);
                return { status: "error", error: data.error };
            }
            
            // Apply changes if action is not "keep"
            if (data.action !== "keep") {
                // Store original content for potential recovery
                if (data.action === "encrypt") {
                    encryptedElements.set(element, text);
                    element.classList.add('socioio-encrypted');
                }
                
                // Replace content
                element.textContent = data.processed_text;
                
                // Update stats
                updateStats('text');
                
                // Add visual indicator for moderation
                addModerationIndicator(element, data.action, data.reasons);
                
                return { 
                    status: "filtered", 
                    action: data.action, 
                    reasons: data.reasons 
                };
            }
            
            return { status: "kept" };
            
        } catch (error) {
            debug('Error in fetch request:', error);
            return { status: "error", error: error.message };
        }
        
    } catch (error) {
        debug('Error in text processing:', error);
        return { status: "error", error: error.message };
    }
}

// Process an image element with client-side backup detection
async function processImageElement(element) {
    try {
        // Skip if the element has been removed from the DOM
        if (!element.isConnected) {
            debug("Element no longer connected to DOM");
            return { status: "skipped", reason: "element_not_connected" };
        }
        
        const src = element.src;
        if (!src) {
            debug("Image has no source");
            return { status: "skipped", reason: "no_source" };
        }
        
        debug(`Processing image: ${src}`);
        
        // Send to backend for analysis
        try {
            debug("Sending image to backend");
            
            const response = await fetch(`${API_BASE_URL}/analyze_image`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    image_url: src,
                    url: window.location.href
                })
            });
            
            // Parse the response
            const data = await response.json();
            
            debug("Image analysis response:", data);
            
            if (data.error) {
                debug('Error analyzing image:', data.error);
                return { status: "error", error: data.error };
            }
            
            // Apply changes if action is not "allow"
            if (data.action !== "allow") {
                debug(`Applying action: ${data.action} to image: ${src}`);
                
                if (data.action === "block") {
                    // Replace with block notice
                    const blockNotice = document.createElement('div');
                    blockNotice.className = 'socioio-blocked-image';
                    blockNotice.innerHTML = `
                        <div>
                            <div class="socioio-icon">🚫</div>
                            <div class="socioio-message">Content Blocked</div>
                            <div class="socioio-reasons">
                                ${data.reasons?.map(reason => `<div>${reason}</div>`).join('') || 'Inappropriate content detected'}
                            </div>
                        </div>
                    `;
                    
                    element.parentNode.replaceChild(blockNotice, element);
                    debug("Image blocked and replaced with notice");
                    
                    // Save to filter history
                    saveFilterHistory('image', src, data.reasons || ['Inappropriate content detected']);
                    
                } else if (data.action === "blur") {
                    // Check if element is already in a wrapper
                    let wrapper = element.closest('.socioio-image-container');
                    
                    if (!wrapper) {
                        // Create a wrapper for the image
                        wrapper = document.createElement('div');
                        wrapper.className = 'socioio-image-container';
                        element.parentNode.insertBefore(wrapper, element);
                        wrapper.appendChild(element);
                    }
                    
                    // Apply blur effect
                    element.style.filter = "blur(20px)";
                    debug("Applied blur effect to image");
                    
                    // Check if overlay already exists to avoid duplicates
                    let overlay = wrapper.querySelector('.socioio-image-overlay');
                    
                    if (!overlay) {
                        // Create overlay
                        overlay = document.createElement('div');
                        overlay.className = 'socioio-image-overlay';
                        
                        overlay.innerHTML = `
                            <div class="socioio-overlay-content">
                                <div class="socioio-icon">⚠️</div>
                                <div class="socioio-message">Potentially sensitive content</div>
                                <div class="socioio-reasons">
                                    ${data.reasons?.map(reason => `<div>${reason}</div>`).join('') || 'Sensitive content detected'}
                                </div>
                                <div class="socioio-instruction">Click to view</div>
                            </div>
                        `;
                        
                        // Add click handler to toggle blur
                        overlay.addEventListener('click', function(e) {
                            e.preventDefault();
                            e.stopPropagation();
                            
                            if (element.style.filter === "blur(20px)") {
                                element.style.filter = "none";
                                overlay.classList.add('socioio-subtle');
                            } else {
                                element.style.filter = "blur(20px)";
                                overlay.classList.remove('socioio-subtle');
                            }
                        });
                        
                        wrapper.appendChild(overlay);
                        
                        // Save to filter history
                        saveFilterHistory('image', src, data.reasons || ['Potentially sensitive content']);
                    }
                }
                
                // Update stats
                updateStats('image');
                
                return { 
                    status: "filtered", 
                    action: data.action, 
                    reasons: data.reasons 
                };
            }
            
            return { status: "kept" };
            
        } catch (error) {
            debug('Error in fetch request:', error);
            
            // If backend fails, apply client-side filtering on test pages
            if (window.location.href.includes("test.html")) {
                debug("Applying client-side image moderation for test page");
                
                // Check if element is already in a wrapper
                let wrapper = element.closest('.socioio-image-container');
                
                if (!wrapper) {
                    // Create a wrapper for the image
                    wrapper = document.createElement('div');
                    wrapper.className = 'socioio-image-container';
                    element.parentNode.insertBefore(wrapper, element);
                    wrapper.appendChild(element);
                }
                
                // Apply blur effect
                element.style.filter = "blur(20px)";
                
                // Check if overlay already exists
                let overlay = wrapper.querySelector('.socioio-image-overlay');
                
                if (!overlay) {
                    // Create overlay
                    overlay = document.createElement('div');
                    overlay.className = 'socioio-image-overlay';
                    
                    overlay.innerHTML = `
                        <div class="socioio-overlay-content">
                            <div class="socioio-icon">⚠️</div>
                            <div class="socioio-message">Potentially sensitive content</div>
                            <div class="socioio-reasons">This image may contain inappropriate content</div>
                            <div class="socioio-instruction">Click to view</div>
                        </div>
                    `;
                    
                    // Add click handler to toggle blur
                    overlay.addEventListener('click', function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        
                        if (element.style.filter === "blur(20px)") {
                            element.style.filter = "none";
                            overlay.classList.add('socioio-subtle');
                        } else {
                            element.style.filter = "blur(20px)";
                            overlay.classList.remove('socioio-subtle');
                        }
                    });
                    
                    wrapper.appendChild(overlay);
                    
                    // Save to filter history
                    saveFilterHistory('image', src, ['Client-side detection for testing']);
                }
                
                // Update stats
                updateStats('image');
                
                return { status: "filtered", action: "blur", reasons: ["Client-side detection for testing"] };
            }
            
            return { status: "error", error: error.message };
        }
        
    } catch (error) {
        debug('Error in image processing:', error);
        return { status: "error", error: error.message };
    }
}

// Add visual indicator for moderated content - FIXED to prevent duplicates
function addModerationIndicator(element, action, reasons) {
    try {
        // Clear any existing indicators for this element
        const existingIndicators = document.querySelectorAll('.' + INDICATOR_CLASS);
        for (const indicator of existingIndicators) {
            const rect = indicator.getBoundingClientRect();
            const elementRect = element.getBoundingClientRect();
            
            // If indicator is close to this element, it's likely for this element
            if (Math.abs(rect.top - elementRect.top) < 50 && 
                Math.abs(rect.left - elementRect.left) < 50) {
                indicator.remove();
            }
        }
        
        // Create tooltip container
        const tooltip = document.createElement('div');
        tooltip.className = `${INDICATOR_CLASS} ${action === 'remove' ? 'socioio-removed' : action === 'encrypt' ? 'socioio-encrypted-indicator' : ''}`;
        
        // Create tooltip content
        let iconSymbol = action === 'remove' ? '🚫' : action === 'encrypt' ? '🔒' : '⚠️';
        let actionText = action === 'remove' ? 'Content Removed' : action === 'encrypt' ? 'Content Encrypted' : 'Content Flagged';
        
        tooltip.innerHTML = `
            <div class="socioio-indicator-content">
                <div class="socioio-icon">${iconSymbol}</div>
                <div class="socioio-message">${actionText}</div>
                <div class="socioio-reasons">
                    ${reasons.map(reason => `<div>${reason}</div>`).join('')}
                </div>
            </div>
        `;
        
        // Position the tooltip - avoid diagonal stacking by using fixed position to top-left of element
        const rect = element.getBoundingClientRect();
        tooltip.style.position = 'absolute';
        tooltip.style.top = `${window.scrollY + rect.top - 40}px`;
        tooltip.style.left = `${window.scrollX + rect.left}px`;
        
        // Add a unique ID to associate with this element
        const elementId = element.dataset.socioioId || Math.random().toString(36).substring(2, 9);
        element.dataset.socioioId = elementId;
        tooltip.dataset.forElement = elementId;
        
        // Add to document
        document.body.appendChild(tooltip);
        
        // Show tooltip briefly
        setTimeout(() => {
            tooltip.classList.add('socioio-show');
            
            // Hide and remove after a few seconds
            setTimeout(() => {
                tooltip.classList.remove('socioio-show');
                setTimeout(() => {
                    if (tooltip.parentNode) {
                        tooltip.parentNode.removeChild(tooltip);
                    }
                }, 300);
            }, 3000);
        }, 10);
    } catch (error) {
        debug('Error adding moderation indicator:', error);
    }
}

// Update statistics
function updateStats(type) {
    debug(`Updating stats for ${type}`);
    try {
        chrome.runtime.sendMessage({
            action: 'updateStats',
            type: type,
            count: 1
        }, response => {
            debug("Stats update response:", response);
        });
        
        chrome.storage.local.get([`${type}Filtered`], function(result) {
            const newCount = (result[`${type}Filtered`] || 0) + 1;
            debug(`New count for ${type}Filtered:`, newCount);
            chrome.storage.local.set({ [`${type}Filtered`]: newCount });
        });
    } catch (e) {
        debug("Error updating stats:", e);
    }
}

// Restore original content
function restoreOriginalContent() {
    debug("Restoring original content");
    
    // Restore encrypted elements
    for (const [element, originalText] of encryptedElements.entries()) {
        if (element.isConnected) {
            element.textContent = originalText;
            element.classList.remove('socioio-encrypted');
        }
    }
    
    // Clear the map
    encryptedElements.clear();
    
    // Remove all socioio elements
    document.querySelectorAll('.socioio-blocked-image, .socioio-image-overlay, .' + INDICATOR_CLASS).forEach(el => {
        el.parentNode.removeChild(el);
    });
    
    // Remove blur from all images
    document.querySelectorAll('img[style*="blur"]').forEach(img => {
        img.style.filter = 'none';
    });
}

// Apply recovered content from popup
function applyRecoveredContent(recoveredText) {
    debug("Applying recovered content:", recoveredText);
    
    // Find all encrypted elements
    document.querySelectorAll('.socioio-encrypted').forEach(el => {
        el.textContent = recoveredText;
        el.classList.remove('socioio-encrypted');
    });
}

// Inject CSS styles for our elements
function injectStyles() {
    debug("Injecting styles");
    
    // Check if styles are already injected
    if (document.getElementById('socioio-styles')) return;
    
    const styles = `
        .socioio-text-indicator {
            position: absolute;
            background-color: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 14px;
            max-width: 300px;
            z-index: 999999;
            opacity: 0;
            transform: translateY(10px);
            transition: opacity 0.3s, transform 0.3s;
            pointer-events: none;
        }
        
        .socioio-show {
            opacity: 1;
            transform: translateY(0);
        }
        
        .socioio-removed {
            background-color: rgba(220, 53, 69, 0.9);
        }
        
        .socioio-encrypted-indicator {
            background-color: rgba(255, 193, 7, 0.9);
            color: black;
        }
        
        .socioio-indicator-content {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
        }
        
        .socioio-icon {
            font-size: 18px;
            margin-bottom: 4px;
        }
        
        .socioio-message {
            font-weight: bold;
            margin-bottom: 4px;
        }
        
        .socioio-reasons {
            font-size: 12px;
            opacity: 0.9;
        }
        
        .socioio-blocked-image {
            background-color: #f8d7da;
            border: 1px solid #f5c6cb;
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            text-align: center;
            padding: 20px;
            margin: 10px 0;
            color: #721c24;
        }
        
        .socioio-image-container {
            position: relative;
            display: inline-block;
            max-width: 100%;
        }
        
        .socioio-image-overlay {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: rgba(0, 0, 0, 0.7);
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            padding: 20px;
            text-align: center;
            cursor: pointer;
            opacity: 1;
            transition: opacity 0.3s;
        }
        
        .socioio-subtle {
            background-color: rgba(0, 0, 0, 0.5);
            opacity: 0;
        }
        
        .socioio-overlay-content {
            max-width: 80%;
        }
        
        .socioio-instruction {
            margin-top: 10px;
            font-size: 12px;
            opacity: 0.8;
            text-decoration: underline;
        }
    `;
    
    const styleElement = document.createElement('style');
    styleElement.id = 'socioio-styles';
    styleElement.textContent = styles;
    document.head.appendChild(styleElement);
}

// On page unload, clear notifications
window.addEventListener('beforeunload', function() {
    clearNotifications();
});

// Save filtered content to history
function saveFilterHistory(type, content, reasons) {
    try {
        // Create history item
        const historyItem = {
            type: type,
            content: type === 'image' ? content : content.substring(0, 100) + (content.length > 100 ? '...' : ''),
            originalContent: content,
            reasons: reasons || ['Filtered content'],
            timestamp: new Date().toISOString(),
            url: window.location.href,
            domain: new URL(window.location.href).hostname
        };
        
        // Get existing history
        chrome.storage.local.get(['filterHistory'], function(result) {
            let history = result.filterHistory || [];
            
            // Add new item at the beginning
            history.unshift(historyItem);
            
            // Limit history to 100 items
            if (history.length > 100) {
                history = history.slice(0, 100);
            }
            
            // Save updated history
            chrome.storage.local.set({ 'filterHistory': history }, function() {
                debug('Filter history updated successfully');
            });
        });
    } catch (e) {
        debug('Error saving to filter history:', e);
    }
}