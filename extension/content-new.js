// Socio.io Content Moderation - Content Script
// This script runs on all web pages and moderates content

// Configuration
const API_BASE_URL = 'http://127.0.0.1:5000';
const EXCLUSION_CLASS = 'socioio-processed';
const INDICATOR_CLASS = 'socioio-indicator';
const BATCH_SIZE = 10;
const BATCH_DELAY = 100;
const DEBOUNCE_DELAY = 500;

// Selectors for text elements to moderate
const TEXT_SELECTORS = 'p, h1, h2, h3, h4, h5, h6, span, div:not(:has(*)), a, li, td, th, blockquote, pre, code';

// Selectors for image elements to moderate
const IMAGE_SELECTORS = 'img';

// State variables
let isEnabled = true;
let currentlyProcessing = false;
let processingQueue = [];
let textElementsProcessed = new Set();
let imageElementsProcessed = new Set();

// Debug logging
function debug(message, obj = null) {
    const timestamp = new Date().toISOString();
    if (obj) {
        console.log(`[Socio.io ${timestamp}]`, message, obj);
    } else {
        console.log(`[Socio.io ${timestamp}]`, message);
    }
}

// Initialize the extension
function initialize() {
    debug("Initializing Socio.io content moderation");
    
    // Check if we should be enabled
    chrome.storage.local.get(['enabled'], function(result) {
        isEnabled = result.enabled !== false;  // Default to true if not set
        debug("Protection enabled:", isEnabled);
        
        if (isEnabled) {
            // Start the content moderation
            setupObserver();
            scanContentForModeration();
            
            // Add styles for tooltips and overlays
            injectStyles();
            
            // Send a test request to the backend to check connection
            fetch(`${API_BASE_URL}/ping`)
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

// Notify the background script that we're active
function notifyBackgroundScript() {
    chrome.runtime.sendMessage({
        action: 'contentScriptActive',
        url: window.location.href
    }, function(response) {
        if (chrome.runtime.lastError) {
            debug("Error notifying background script:", chrome.runtime.lastError);
        } else {
            debug("Background script notified:", response);
        }
    });
}

// Set up mutation observer to detect new content
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
        characterData: true
    });
    
    debug("Mutation observer set up");
}

// Debounce function to prevent too many scans
function debounce(func, wait) {
    let timeout;
    return function() {
        const args = arguments;
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
    
    // Count image elements in this batch for debugging
    const imageCount = batch.filter(item => item.type === 'image').length;
    debug(`Batch contains ${imageCount} image elements`);
    
    const promises = batch.map(processElement);
    
    // When all elements in the batch are processed
    Promise.allSettled(promises).then(results => {
        debug("Batch processing complete", results);
        
        // Count successful image filtrations - only count images that were actually filtered
        const successfulImageFilters = results.filter((result, index) => {
            return batch[index].type === 'image' && 
                   result.status === 'fulfilled' && 
                   result.value && 
                   result.value.status === 'filtered' &&
                   result.value.shouldFilter === true; // Only count if it should be filtered
        }).length;
        
        debug(`Successfully filtered ${successfulImageFilters} images in this batch`);
        
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
                    // Make sure the image is fully loaded before processing
                    if (item.element.complete) {
                        // Image is already loaded, process it immediately
                        const result = processImageElement(item.element);
                        debug("Image processing complete", result);
                        
                        // Only count as filtered if the image was actually filtered
                        if (result && result.status === "filtered" && result.shouldFilter) {
                            debug("Image was filtered:", result.reasons);
                        } else {
                            debug("Image was not filtered or kept:", result);
                        }
                        
                        resolve(result);
                    } else {
                        // Wait for the image to load before processing
                        item.element.onload = function() {
                            try {
                                const result = processImageElement(item.element);
                                debug("Image processing complete (after load)", result);
                                
                                // Only count as filtered if the image was actually filtered
                                if (result && result.status === "filtered" && result.shouldFilter) {
                                    debug("Image was filtered after load:", result.reasons);
                                } else {
                                    debug("Image was not filtered or kept after load:", result);
                                }
                                
                                resolve(result);
                            } catch (loadError) {
                                debug("Image processing error after load", loadError);
                                reject(loadError);
                            }
                        };
                        
                        // Handle image load errors
                        item.element.onerror = function() {
                            debug("Image failed to load", item.element.src);
                            resolve({ status: "skipped", reason: "image_load_failed" });
                        };
                        
                        // Set a timeout in case the image takes too long to load
                        setTimeout(() => {
                            if (!item.element.complete) {
                                debug("Image load timeout", item.element.src);
                                resolve({ status: "skipped", reason: "image_load_timeout" });
                            }
                        }, 5000); // 5 second timeout
                    }
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
        
        // Disable random filtering completely
        let isRandomFilter = false;
        
        // Only filter if the text is short - don't filter long paragraphs
        if (text.length > 200) {
            isProfanity = false;
            isHateSpeech = false;
        }
        
        // If we detect something locally, handle it (this is backup in case backend fails)
        if (isProfanity || isHateSpeech || isRandomFilter) {
            debug("Client-side detected problematic content");
            
            // Store the original text for recovery
            const originalText = text;
            
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
            const reasons = [
                isProfanity ? "Profanity detected" : "", 
                isHateSpeech ? "Hate speech detected" : "",
                isRandomFilter ? "Content filtered for testing" : ""
            ].filter(reason => reason);
                
            // Add visual indicator
            addModerationIndicator(element, "remove", reasons);
            
            // Save to filter history
            saveFilterHistory('text', text, reasons);
            
            // Update stats
            updateStats('text');
            
            return { status: "filtered", action: "remove", reasons: reasons };
        }
        
        // Try to send to backend for analysis
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
            
            // Apply changes if action is not "allow"
            if (data.action !== "allow") {
                debug(`Applying action: ${data.action} to text`);
                
                if (data.action === "remove") {
                    // Store the original text for recovery
                    const originalText = text;
                    
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
                    
                    // Add visual indicator
                    addModerationIndicator(element, "remove", data.reasons);
                    
                    // Save to filter history
                    saveFilterHistory('text', text, data.reasons);
                    
                } else if (data.action === "encrypt") {
                    // Replace with encrypted version
                    element.textContent = data.processed_text;
                    element.classList.add('socioio-encrypted');
                    
                    // Add visual indicator
                    addModerationIndicator(element, "encrypt", data.reasons);
                    
                    // Save to filter history
                    saveFilterHistory('text', text, data.reasons);
                }
                
                // Update stats
                updateStats('text');
                
                return { status: "filtered", action: data.action, reasons: data.reasons };
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

// Add visual indicator for moderated content - Enhanced user-friendly version
function addModerationIndicator(element, action, reasons) {
    try {
        // Clear any existing indicators for this element
        const existingIndicators = document.querySelectorAll('.' + INDICATOR_CLASS);
        for (const indicator of existingIndicators) {
            const rect = indicator.getBoundingClientRect();
            const elementRect = element.getBoundingClientRect();
            
            // If the indicator is close to this element, remove it
            if (Math.abs(rect.top - elementRect.top) < 30 && 
                Math.abs(rect.left - elementRect.left) < 30) {
                indicator.parentNode.removeChild(indicator);
            }
        }
        
        // Create indicator element
        const indicator = document.createElement('div');
        indicator.className = INDICATOR_CLASS;
        
        // Set icon, text and color based on action
        let icon, text, color;
        if (action === "remove") {
            icon = "🛡️";
            text = "View";
            color = "#4285f4"; // Google blue
        } else if (action === "encrypt") {
            icon = "🔒";
            text = "View";
            color = "#0f9d58"; // Google green
        } else {
            icon = "⚠️";
            text = "View";
            color = "#f4b400"; // Google yellow
        }
        
        // Position the indicator
        const rect = element.getBoundingClientRect();
        indicator.style.position = "absolute";
        indicator.style.top = `${window.scrollY + rect.top}px`;
        indicator.style.left = `${window.scrollX + rect.right - 50}px`; // Position at the right side
        indicator.style.backgroundColor = color;
        indicator.style.color = "white";
        indicator.style.padding = "4px 8px";
        indicator.style.borderRadius = "4px";
        indicator.style.fontSize = "12px";
        indicator.style.zIndex = "9999";
        indicator.style.cursor = "pointer";
        indicator.style.boxShadow = "0 2px 5px rgba(0,0,0,0.2)";
        indicator.style.display = "flex";
        indicator.style.alignItems = "center";
        indicator.style.transition = "all 0.2s ease";
        indicator.innerHTML = `${icon} <span style="margin-left: 4px;">${text}</span>`;
        
        // Create tooltip
        const tooltip = document.createElement('div');
        tooltip.className = 'socioio-tooltip';
        tooltip.style.display = "none";
        tooltip.style.position = "absolute";
        tooltip.style.top = "100%";
        tooltip.style.right = "0";
        tooltip.style.backgroundColor = "rgba(0, 0, 0, 0.8)";
        tooltip.style.color = "white";
        tooltip.style.padding = "10px";
        tooltip.style.borderRadius = "4px";
        tooltip.style.width = "250px";
        tooltip.style.zIndex = "10000";
        tooltip.style.boxShadow = "0 3px 10px rgba(0,0,0,0.3)";
        
        // Add reasons to tooltip
        let tooltipContent = `<div style="font-weight: bold; margin-bottom: 8px;">Content Filtered by Socio.io</div>`;
        if (reasons && reasons.length > 0) {
            tooltipContent += `<div style="font-size: 12px; margin-bottom: 5px;">Filtered for the following reasons:</div>`;
            tooltipContent += `<ul style="margin: 5px 0; padding-left: 15px; font-size: 12px;">`;
            reasons.forEach(reason => {
                tooltipContent += `<li>${reason}</li>`;
            });
            tooltipContent += `</ul>`;
        }
        tooltipContent += `<div style="font-size: 12px; margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.2);">
            Click to view the original content
        </div>`;
        tooltip.innerHTML = tooltipContent;
        
        // Add tooltip to indicator
        indicator.appendChild(tooltip);
        
        // Show/hide tooltip on hover
        indicator.addEventListener('mouseenter', () => {
            tooltip.style.display = "block";
            indicator.style.backgroundColor = darkenColor(color, 10);
        });
        
        indicator.addEventListener('mouseleave', () => {
            tooltip.style.display = "none";
            indicator.style.backgroundColor = color;
        });
        
        // Add click handler to show original content
        indicator.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            // Get the original content from history
            chrome.storage.local.get(['filterHistory'], function(result) {
                const history = result.filterHistory || [];
                
                // Find the matching content
                const matchingItem = history.find(item => {
                    // Check if this element contains the filtered text
                    return element.classList.contains('socioio-filtered-text') && 
                           item.type === 'text' && 
                           element.textContent.includes('[Content filtered by Socio.io]');
                });
                
                if (matchingItem) {
                    // Show a modal with the original content
                    showContentModal(matchingItem.originalContent, reasons);
                } else {
                    // If we can't find the exact match, show a generic message
                    showContentModal("Original content not found in history. Please use the recovery option from the extension popup.", []);
                }
            });
        });
        
        // Add to document
        document.body.appendChild(indicator);
        
    } catch (error) {
        debug('Error adding moderation indicator:', error);
    }
}

// Helper function to darken a color
function darkenColor(color, percent) {
    // Convert hex to RGB
    let r, g, b;
    if (color.startsWith('#')) {
        r = parseInt(color.substr(1, 2), 16);
        g = parseInt(color.substr(3, 2), 16);
        b = parseInt(color.substr(5, 2), 16);
    } else {
        return color; // Return original if not hex
    }
    
    // Darken
    r = Math.max(0, Math.floor(r * (100 - percent) / 100));
    g = Math.max(0, Math.floor(g * (100 - percent) / 100));
    b = Math.max(0, Math.floor(b * (100 - percent) / 100));
    
    // Convert back to hex
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// Show a modal with the original content
function showContentModal(content, reasons) {
    // Create modal container
    const modal = document.createElement('div');
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100%';
    modal.style.height = '100%';
    modal.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    modal.style.display = 'flex';
    modal.style.justifyContent = 'center';
    modal.style.alignItems = 'center';
    modal.style.zIndex = '99999';
    
    // Create modal content
    const modalContent = document.createElement('div');
    modalContent.style.backgroundColor = 'white';
    modalContent.style.padding = '20px';
    modalContent.style.borderRadius = '8px';
    modalContent.style.maxWidth = '600px';
    modalContent.style.maxHeight = '80%';
    modalContent.style.overflow = 'auto';
    modalContent.style.boxShadow = '0 5px 15px rgba(0, 0, 0, 0.3)';
    
    // Add header
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.marginBottom = '15px';
    header.style.paddingBottom = '10px';
    header.style.borderBottom = '1px solid #eee';
    
    const title = document.createElement('h3');
    title.style.margin = '0';
    title.style.color = '#333';
    title.textContent = 'Original Filtered Content';
    
    const closeBtn = document.createElement('button');
    closeBtn.style.background = 'none';
    closeBtn.style.border = 'none';
    closeBtn.style.fontSize = '20px';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.color = '#666';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => {
        document.body.removeChild(modal);
    });
    
    header.appendChild(title);
    header.appendChild(closeBtn);
    
    // Add content
    const contentDiv = document.createElement('div');
    contentDiv.style.marginBottom = '15px';
    contentDiv.style.color = '#333';
    contentDiv.style.lineHeight = '1.5';
    contentDiv.textContent = content;
    
    // Add reasons if available
    let reasonsDiv = '';
    if (reasons && reasons.length > 0) {
        reasonsDiv = document.createElement('div');
        reasonsDiv.style.marginTop = '15px';
        reasonsDiv.style.padding = '10px';
        reasonsDiv.style.backgroundColor = '#f8f9fa';
        reasonsDiv.style.borderRadius = '4px';
        reasonsDiv.style.fontSize = '14px';
        
        const reasonsTitle = document.createElement('div');
        reasonsTitle.style.fontWeight = 'bold';
        reasonsTitle.style.marginBottom = '5px';
        reasonsTitle.textContent = 'Filtered for the following reasons:';
        
        const reasonsList = document.createElement('ul');
        reasonsList.style.margin = '5px 0';
        reasonsList.style.paddingLeft = '20px';
        
        reasons.forEach(reason => {
            const item = document.createElement('li');
            item.textContent = reason;
            reasonsList.appendChild(item);
        });
        
        reasonsDiv.appendChild(reasonsTitle);
        reasonsDiv.appendChild(reasonsList);
    }
    
    // Add footer with buttons
    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.marginTop = '15px';
    footer.style.paddingTop = '10px';
    footer.style.borderTop = '1px solid #eee';
    
    const copyBtn = document.createElement('button');
    copyBtn.style.backgroundColor = '#4285f4';
    copyBtn.style.color = 'white';
    copyBtn.style.border = 'none';
    copyBtn.style.padding = '8px 15px';
    copyBtn.style.borderRadius = '4px';
    copyBtn.style.cursor = 'pointer';
    copyBtn.style.marginLeft = '10px';
    copyBtn.textContent = 'Copy to Clipboard';
    copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(content)
            .then(() => {
                copyBtn.textContent = 'Copied!';
                setTimeout(() => {
                    copyBtn.textContent = 'Copy to Clipboard';
                }, 2000);
            })
            .catch(err => {
                console.error('Failed to copy: ', err);
            });
    });
    
    footer.appendChild(copyBtn);
    
    // Assemble modal
    modalContent.appendChild(header);
    modalContent.appendChild(contentDiv);
    if (reasonsDiv) modalContent.appendChild(reasonsDiv);
    modalContent.appendChild(footer);
    
    modal.appendChild(modalContent);
    
    // Add click outside to close
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });
    
    // Add to document
    document.body.appendChild(modal);
}

// Store processed elements for persistence
function storeProcessedElements() {
    // This is a placeholder for future implementation
    // We might want to store the IDs of processed elements in local storage
    // so we don't reprocess them on page reload
}

// Update stats in the background script
function updateStats(type) {
    try {
        chrome.runtime.sendMessage({
            action: 'updateStats',
            type: type,
            count: 1
        }, function(response) {
            if (chrome.runtime.lastError) {
                debug("Error updating stats:", chrome.runtime.lastError);
            } else {
                debug("Stats updated:", response);
            }
        });
    } catch (e) {
        debug("Error sending stats update:", e);
    }
}

// Restore original content when protection is disabled
function restoreOriginalContent() {
    debug("Restoring original content");
    
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
    
    try {
        // Find all elements with our new filtered text class
        const modernFilteredElements = Array.from(document.querySelectorAll('.socioio-filtered-text'));
        
        // Also find legacy elements with asterisks (for backward compatibility)
        const legacyFilteredElements = Array.from(document.querySelectorAll('p, span, div, h1, h2, h3, h4, h5, h6'))
            .filter(el => {
                // Check if the element contains only asterisks
                const text = el.textContent.trim();
                return text.length > 0 && text.split('').every(char => char === '*');
            });
        
        // Also find elements with our filtered content message
        const messageFilteredElements = Array.from(document.querySelectorAll('p, span, div, h1, h2, h3, h4, h5, h6'))
            .filter(el => {
                const text = el.textContent.trim();
                return text.includes('[Content filtered by Socio.io]');
            });
        
        // Combine all types of filtered elements
        const allFilteredElements = [
            ...modernFilteredElements, 
            ...legacyFilteredElements,
            ...messageFilteredElements
        ];
        
        debug(`Found ${allFilteredElements.length} filtered elements to restore (${modernFilteredElements.length} modern, ${legacyFilteredElements.length} legacy, ${messageFilteredElements.length} message)`);
        
        // If no filtered elements found, try to create a new element with the recovered text
        if (allFilteredElements.length === 0) {
            debug("No filtered elements found, creating a new element with the recovered text");
            
            // Create a notification to show the recovered text
            const notification = document.createElement('div');
            notification.style.position = 'fixed';
            notification.style.top = '20px';
            notification.style.left = '50%';
            notification.style.transform = 'translateX(-50%)';
            notification.style.backgroundColor = '#4285f4';
            notification.style.color = 'white';
            notification.style.padding = '15px 20px';
            notification.style.borderRadius = '5px';
            notification.style.zIndex = '9999999';
            notification.style.fontFamily = 'Arial, sans-serif';
            notification.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.2)';
            notification.style.maxWidth = '80%';
            notification.style.maxHeight = '80%';
            notification.style.overflow = 'auto';
            
            // Add a title
            const title = document.createElement('div');
            title.style.fontWeight = 'bold';
            title.style.marginBottom = '10px';
            title.textContent = 'Recovered Content:';
            notification.appendChild(title);
            
            // Add the recovered text
            const content = document.createElement('div');
            content.style.whiteSpace = 'pre-wrap';
            content.style.wordBreak = 'break-word';
            content.textContent = recoveredText;
            notification.appendChild(content);
            
            // Add a close button
            const closeButton = document.createElement('button');
            closeButton.style.position = 'absolute';
            closeButton.style.top = '5px';
            closeButton.style.right = '5px';
            closeButton.style.background = 'none';
            closeButton.style.border = 'none';
            closeButton.style.color = 'white';
            closeButton.style.fontSize = '20px';
            closeButton.style.cursor = 'pointer';
            closeButton.textContent = '×';
            closeButton.addEventListener('click', () => {
                document.body.removeChild(notification);
            });
            notification.appendChild(closeButton);
            
            // Add to document
            document.body.appendChild(notification);
            
            // Remove after 30 seconds
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 30000);
            
            return;
        }
        
        // If we found filtered elements, restore the first one
        if (allFilteredElements.length > 0) {
            const elementToRestore = allFilteredElements[0];
            
            // Restore the content
            elementToRestore.textContent = recoveredText;
            
            // Remove the filtered class if it exists
            elementToRestore.classList.remove('socioio-filtered-text');
            
            // Remove the indicator if it exists
            const indicators = document.querySelectorAll('.' + INDICATOR_CLASS);
            for (const indicator of indicators) {
                const rect = indicator.getBoundingClientRect();
                const elementRect = elementToRestore.getBoundingClientRect();
                
                // If the indicator is close to this element, remove it
                if (Math.abs(rect.top - elementRect.top) < 50 && 
                    Math.abs(rect.left - elementRect.left) < 100) {
                    indicator.parentNode.removeChild(indicator);
                }
            }
        }
        
        // Also try to find and update encrypted elements
        document.querySelectorAll('.socioio-encrypted').forEach(el => {
            el.textContent = recoveredText;
            el.classList.remove('socioio-encrypted');
        });
        
        // Show notification
        const notification = document.createElement('div');
        notification.style.position = 'fixed';
        notification.style.top = '20px';
        notification.style.left = '50%';
        notification.style.transform = 'translateX(-50%)';
        notification.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
        notification.style.color = 'white';
        notification.style.padding = '10px 20px';
        notification.style.borderRadius = '5px';
        notification.style.zIndex = '9999999';
        notification.style.fontFamily = 'Arial, sans-serif';
        notification.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.2)';
        
        if (allFilteredElements.length > 0) {
            notification.textContent = 'Content restored successfully!';
        } else {
            notification.textContent = 'No filtered content found to restore. Content copied to clipboard.';
            
            // Copy to clipboard as fallback
            navigator.clipboard.writeText(recoveredText)
                .catch(err => {
                    debug("Error copying to clipboard:", err);
                });
        }
        
        document.body.appendChild(notification);
        
        // Remove notification after 3 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 3000);
        
        debug("Content applied to page");
    } catch (e) {
        debug("Error applying recovered content:", e);
        
        // Show error notification
        const notification = document.createElement('div');
        notification.style.position = 'fixed';
        notification.style.top = '20px';
        notification.style.left = '50%';
        notification.style.transform = 'translateX(-50%)';
        notification.style.backgroundColor = 'rgba(220, 53, 69, 0.9)';
        notification.style.color = 'white';
        notification.style.padding = '10px 20px';
        notification.style.borderRadius = '5px';
        notification.style.zIndex = '9999999';
        notification.style.fontFamily = 'Arial, sans-serif';
        notification.textContent = 'Error restoring content. Try copying it manually.';
        
        document.body.appendChild(notification);
        
        // Remove notification after 3 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 3000);
    }
}

// Inject CSS styles for our elements
function injectStyles() {
    debug("Injecting styles");
    
    const styles = `
        .socioio-image-container {
            position: relative !important;
            display: inline-block !important;
            overflow: hidden !important;
        }
        
        .socioio-image-container img {
            transition: filter 0.3s ease !important;
        }
        
        .socioio-image-overlay {
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            right: 0 !important;
            bottom: 0 !important;
            background-color: rgba(0, 0, 0, 0.7) !important;
            color: white !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            text-align: center !important;
            z-index: 9999 !important;
            cursor: pointer !important;
            transition: opacity 0.3s ease !important;
            padding: 20px !important;
        }
        
        .socioio-subtle {
            background-color: rgba(0, 0, 0, 0.5) !important;
            opacity: 0 !important;
            pointer-events: none !important;
        }
        
        .socioio-overlay-content {
            max-width: 300px !important;
        }
        
        .socioio-icon {
            font-size: 24px !important;
            margin-bottom: 10px !important;
        }
        
        .socioio-message {
            font-weight: bold !important;
            margin-bottom: 10px !important;
        }
        
        .socioio-reasons {
            font-size: 12px !important;
            margin-bottom: 10px !important;
        }
        
        .socioio-instruction {
            font-size: 12px !important;
            font-style: italic !important;
        }
        
        .socioio-blocked-image {
            display: flex;
            align-items: center;
            justify-content: center;
            background-color: #f8f9fa;
            border: 1px solid #ddd;
            color: #666;
            padding: 20px;
            text-align: center;
            min-height: 100px;
            min-width: 100px;
        }
    `;
    
    const styleElement = document.createElement('style');
    styleElement.id = 'socioio-styles';
    styleElement.textContent = styles;
    document.head.appendChild(styleElement);
}

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

// Initialize when the DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}