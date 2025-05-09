// Enhanced Image Processor for Socio.io
// This module provides robust client-side image filtering

// Debug logging with clear identification
function debug(message, obj = null) {
    const timestamp = new Date().toISOString();
    const prefix = '[Socio.io Image Processor]';
    if (obj) {
        console.log(`${prefix} ${timestamp}:`, message, obj);
    } else {
        console.log(`${prefix} ${timestamp}:`, message);
    }
}

// Update stats directly in storage and via background script
function updateStats(type) {
    try {
        debug(`Updating stats for ${type}`);
        
        // Make sure we're using the correct type
        const statType = type === 'image' ? 'image' : 'text';
        const storageKey = statType === 'image' ? 'imagesFiltered' : 'textFiltered';
        
        // DIRECT UPDATE: Update the storage directly
        chrome.storage.local.get([storageKey], function(result) {
            const currentCount = result[storageKey] || 0;
            const newCount = currentCount + 1;
            
            debug(`Directly updating ${storageKey} from ${currentCount} to ${newCount}`);
            
            // Store in persistent storage
            chrome.storage.local.set({ 
                [storageKey]: newCount 
            }, function() {
                debug(`${storageKey} updated to ${newCount} successfully`);
            });
        });
        
        // BACKUP: Also send message to background script as backup
        chrome.runtime.sendMessage({
            action: 'updateStats',
            type: statType,
            count: 1
        }, function(response) {
            if (chrome.runtime.lastError) {
                debug("Error updating stats via background script:", chrome.runtime.lastError);
            } else {
                debug("Stats updated via background script:", response);
            }
        });
    } catch (e) {
        debug("Error in updateStats:", e);
        
        // Last resort: Try direct storage update with minimal code
        try {
            const key = type === 'image' ? 'imagesFiltered' : 'textFiltered';
            chrome.storage.local.get([key], function(result) {
                const count = (result[key] || 0) + 1;
                chrome.storage.local.set({ [key]: count });
                debug(`Emergency update of ${key} to ${count}`);
            });
        } catch (finalError) {
            debug("Final error in updateStats:", finalError);
        }
    }
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
                debug("Filter history updated successfully");
            });
        });
    } catch (e) {
        debug("Error saving to filter history:", e);
    }
}

// Main image processing function
function processImageElement(element) {
    try {
        debug("Starting image processing");
        
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
        
        // Check if the image should be filtered
        // We'll use a more intelligent approach instead of blurring all images
        
        // 1. Check image URL for explicit keywords
        const lowerSrc = src.toLowerCase();
        const explicitKeywords = ['explicit', 'nsfw', 'adult', 'xxx', 'porn', 'sex'];
        const containsExplicitKeyword = explicitKeywords.some(keyword => lowerSrc.includes(keyword));
        
        // 2. Check image dimensions (very small images are often not important content)
        const isVerySmallImage = element.naturalWidth < 50 || element.naturalHeight < 50;
        
        // 3. Check if image is from known safe sources
        const safeImageSources = [
            'wikipedia.org', 
            'wikimedia.org',
            'github.com',
            'googleusercontent.com/a/',  // Google profile pictures
            'gravatar.com',
            'ytimg.com',                 // YouTube thumbnails
            'twimg.com',                 // Twitter images
            'fbcdn.net',                 // Facebook CDN
            'linkedin.com/media'         // LinkedIn media
        ];
        const isFromSafeSource = safeImageSources.some(source => lowerSrc.includes(source));
        
        // 4. For testing, we'll use a much lower random filter chance (1% chance)
        // In a real implementation, you would use AI image analysis here
        const randomFilterChance = 0.01; // 1% chance - much more selective
        const shouldRandomlyFilter = Math.random() < randomFilterChance;
        
        // Make the filtering decision - be much more selective
        // Only filter if there's an explicit keyword or if it's a large image that's randomly selected
        // and not from a safe source
        const shouldFilter = containsExplicitKeyword || 
                            (shouldRandomlyFilter && 
                             !isFromSafeSource && 
                             !isVerySmallImage && 
                             element.naturalWidth > 200 && 
                             element.naturalHeight > 200);
        
        if (shouldFilter) {
            debug("Image filtering criteria met - applying blur");
            // Apply blur effect
            element.style.filter = "blur(20px)";
        } else {
            debug("Image appears safe - not filtering");
            return { status: "kept", reason: "image_appears_safe" };
        }
        
        // Create a wrapper for the image if it doesn't exist
        let wrapper = element.closest('.socioio-image-container');
        if (!wrapper) {
            // Get the original dimensions and styles
            const originalStyles = window.getComputedStyle(element);
            const width = element.width || element.naturalWidth || parseInt(originalStyles.width) || 300;
            const height = element.height || element.naturalHeight || parseInt(originalStyles.height) || 200;
            
            // Create wrapper with proper dimensions
            wrapper = document.createElement('div');
            wrapper.className = 'socioio-image-container';
            wrapper.style.position = 'relative';
            wrapper.style.display = 'inline-block';
            wrapper.style.width = width + 'px';
            wrapper.style.height = height + 'px';
            
            // Replace the image with our wrapper
            if (element.parentNode) {
                element.parentNode.insertBefore(wrapper, element);
                wrapper.appendChild(element);
                
                // Ensure the image fills the wrapper
                element.style.width = '100%';
                element.style.height = '100%';
                element.style.objectFit = 'cover';
            }
        }
        
        // Check if overlay already exists
        let overlay = wrapper.querySelector('.socioio-image-overlay');
        if (!overlay) {
            // Create overlay
            overlay = document.createElement('div');
            overlay.className = 'socioio-image-overlay';
            
            // Style the overlay
            overlay.style.position = 'absolute';
            overlay.style.top = '0';
            overlay.style.left = '0';
            overlay.style.right = '0';
            overlay.style.bottom = '0';
            overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
            overlay.style.color = 'white';
            overlay.style.display = 'flex';
            overlay.style.alignItems = 'center';
            overlay.style.justifyContent = 'center';
            overlay.style.textAlign = 'center';
            overlay.style.zIndex = '9999';
            overlay.style.cursor = 'pointer';
            
            // Add content to the overlay
            overlay.innerHTML = `
                <div style="max-width: 90%; padding: 15px;">
                    <div style="font-size: 24px; margin-bottom: 10px;">⚠️</div>
                    <div style="font-weight: bold; margin-bottom: 10px;">Image Content Filtered</div>
                    <div style="font-size: 12px; margin-bottom: 10px;">This image has been blurred by Socio.io</div>
                    <div style="font-style: italic; font-size: 12px; border: 1px solid #aaa; display: inline-block; padding: 3px 8px; border-radius: 3px;">Click to view</div>
                </div>
            `;
            
            // Add click handler to toggle blur
            overlay.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                
                if (element.style.filter === "blur(20px)") {
                    // Remove blur
                    element.style.filter = "none";
                    // Hide overlay
                    overlay.style.opacity = '0';
                    overlay.style.pointerEvents = 'none';
                } else {
                    // Apply blur
                    element.style.filter = "blur(20px)";
                    // Show overlay
                    overlay.style.opacity = '1';
                    overlay.style.pointerEvents = 'auto';
                }
            });
            
            // Add the overlay to the wrapper
            wrapper.appendChild(overlay);
        }
        
        // Only update stats and history if we actually filtered the image
        if (shouldFilter) {
            // Determine the reason for filtering
            let filterReason = "Image filtered";
            if (containsExplicitKeyword) {
                filterReason = "Image may contain explicit content";
            } else if (shouldRandomlyFilter) {
                filterReason = "Image selected for content review";
            }
            
            // Save to filter history
            saveFilterHistory('image', src, [filterReason]);
            
            // Update stats - explicitly use 'image' type
            debug("Updating image stats");
            updateStats('image');
            
            // Force a direct update to storage as well
            try {
                // Direct storage update
                chrome.storage.local.get(['imagesFiltered'], function(result) {
                    const currentCount = parseInt(result.imagesFiltered) || 0;
                    const newCount = currentCount + 1;
                    
                    debug(`DIRECT: Updating imagesFiltered from ${currentCount} to ${newCount}`);
                    
                    chrome.storage.local.set({ 'imagesFiltered': newCount }, function() {
                        debug(`DIRECT: imagesFiltered updated to ${newCount}`);
                    });
                });
            } catch (e) {
                debug("Error in direct storage update:", e);
            }
        }
        
        // Determine the reason for filtering (for return value)
        let filterReasons = [];
        if (containsExplicitKeyword) {
            filterReasons.push("Image may contain explicit content");
        } else if (shouldRandomlyFilter) {
            filterReasons.push("Image selected for content review");
        } else {
            filterReasons.push("Image filtered for safety");
        }
        
        // Log success for debugging
        debug("Image successfully filtered:", filterReasons);
        
        return { 
            status: "filtered", 
            action: "blur", 
            reasons: filterReasons,
            shouldFilter: shouldFilter // Include the filtering decision
        };
        
    } catch (error) {
        debug('Error in image processing:', error);
        
        // Try a simpler approach if the main method fails
        try {
            // Just apply blur directly without wrapper
            element.style.filter = "blur(20px)";
            debug("Applied simple blur as fallback");
            
            // Update stats with explicit image type
            debug("Updating image stats (fallback)");
            updateStats('image');
            
            // Save to filter history even in fallback mode
            if (element.src) {
                saveFilterHistory('image', element.src, ["Fallback blur applied"]);
            }
            
            return { 
                status: "filtered", 
                action: "blur", 
                reasons: ["Fallback blur applied"] 
            };
        } catch (fallbackError) {
            debug('Fallback error:', fallbackError);
            return { status: "error", error: error.message };
        }
    }
}

// Create a standalone CSS style element for our components
function injectImageProcessorStyles() {
    // Check if styles are already injected
    if (document.getElementById('socioio-image-processor-styles')) {
        return;
    }
    
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
        }
    `;
    
    const styleElement = document.createElement('style');
    styleElement.id = 'socioio-image-processor-styles';
    styleElement.textContent = styles;
    document.head.appendChild(styleElement);
    
    debug("Image processor styles injected");
}

// Initialize the image processor
(function() {
    debug("Image processor initialized");
    injectImageProcessorStyles();
})();