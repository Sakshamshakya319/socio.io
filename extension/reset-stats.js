// Reset stats script
// This script will reset all stats to 0

// Reset all stats
function resetAllStats() {
  console.log("Resetting all stats...");
  
  chrome.storage.local.set({
    'textFiltered': 0,
    'imagesFiltered': 0
  }, function() {
    console.log("All stats reset to 0");
    
    // Verify the reset
    chrome.storage.local.get(['textFiltered', 'imagesFiltered'], function(result) {
      console.log("Current stats after reset:", result);
    });
  });
}

// Run the reset
resetAllStats();