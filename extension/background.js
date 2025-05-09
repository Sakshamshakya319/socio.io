// Background script for Socio.io content moderation extension
console.log("Background script loaded");

// Extension state
let state = {
  enabled: true,
  textFiltered: 0,
  imagesFiltered: 0
};

// Listen for installation
chrome.runtime.onInstalled.addListener(function() {
  // Set default values
  chrome.storage.local.set({
    enabled: true,
    textFiltered: 0,
    imagesFiltered: 0
  });
  
  console.log('Socio.io Content Moderation extension installed successfully');
});

// Initialize counters from storage
function initCounters() {
  chrome.storage.local.get(['textFiltered', 'imagesFiltered'], function(result) {
    state.textFiltered = result.textFiltered || 0;
    state.imagesFiltered = result.imagesFiltered || 0;
    
    // Update badge with current counts
    updateBadge();
  });
}

// Update the extension badge with the number of filtered items
function updateBadge() {
  const total = state.textFiltered + state.imagesFiltered;
  
  if (total > 0) {
    // Format the badge text - if over 99, show 99+
    const badgeText = total > 99 ? '99+' : total.toString();
    
    // Set the badge text
    chrome.action.setBadgeText({ text: badgeText });
    
    // Set badge background color
    chrome.action.setBadgeBackgroundColor({ color: '#4285f4' });
  } else {
    // Clear the badge if no items filtered
    chrome.action.setBadgeText({ text: '' });
  }
}

// Call initialization
initCounters();

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  console.log("Background script received message:", message);
  
  // Handle different message types
  if (message.action === 'updateStats') {
    // Update statistics
    const type = message.type;
    const count = message.count || 1;
    
    console.log(`Background: Received updateStats for ${type}, count=${count}`);
    
    chrome.storage.local.get([type + 'Filtered'], function(result) {
      const current = parseInt(result[type + 'Filtered']) || 0;
      const newCount = current + count;
      
      console.log(`Background: Updating ${type}Filtered from ${current} to ${newCount}`);
      
      // Update local state
      state[type + 'Filtered'] = newCount;
      
      // Store in persistent storage
      chrome.storage.local.set({ 
        [type + 'Filtered']: newCount 
      }, function() {
        console.log(`Background: Successfully updated ${storageKey} to ${newCount}`);
        
        // Double-check the update
        chrome.storage.local.get([storageKey], function(checkResult) {
          console.log(`Background: Verified ${storageKey} is now ${checkResult[storageKey]}`);
        });
      });
      
      // Update the badge
      updateBadge();
      
      sendResponse({success: true, newCount: newCount});
    });
    
    return true; // Keep the messaging channel open for async response
  }
  
  // Special handler for direct image stats update
  if (message.action === 'directImageUpdate') {
    console.log('Background: Received direct image update request');
    
    chrome.storage.local.get(['imagesFiltered'], function(result) {
      const current = parseInt(result.imagesFiltered) || 0;
      const newCount = current + 1;
      
      console.log(`Background: Directly updating imagesFiltered from ${current} to ${newCount}`);
      
      // Update local state
      state.imagesFiltered = newCount;
      
      // Store in persistent storage
      chrome.storage.local.set({ 
        'imagesFiltered': newCount 
      }, function() {
        console.log(`Background: Successfully updated imagesFiltered to ${newCount}`);
      });
      
      // Update the badge
      updateBadge();
      
      sendResponse({success: true, newCount: newCount});
    });
    
    return true; // Keep the messaging channel open for async response
  }
  
  // Handle resetting stats
  if (message.action === 'resetStats') {
    chrome.storage.local.set({
      textFiltered: 0,
      imagesFiltered: 0
    });
    
    state.textFiltered = 0;
    state.imagesFiltered = 0;
    
    // Update the badge
    updateBadge();
    
    sendResponse({success: true});
    return true;
  }
  
  // Handle status check requests
  if (message.action === 'getStatus') {
    sendResponse({
      enabled: state.enabled,
      textFiltered: state.textFiltered,
      imagesFiltered: state.imagesFiltered,
      status: "Background script is active"
    });
    
    return true;
  }
  
  // Handle content script activation notification
  if (message.action === 'contentScriptActive') {
    console.log("Content script is active on:", message.url);
    sendResponse({status: "Background acknowledged content script"});
    
    return true;
  }
  
  // Default response
  sendResponse({status: "Background script received message"});
  return true;
});