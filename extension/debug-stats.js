// Debug script to fix image stats counter
// This script will directly update the image counter and verify it works

// Function to manually increment the image counter
function incrementImageCounter() {
  console.log("Manually incrementing image counter...");
  
  // Get current count
  chrome.storage.local.get(['imagesFiltered'], function(result) {
    const currentCount = result.imagesFiltered || 0;
    const newCount = currentCount + 1;
    
    console.log(`Updating image counter from ${currentCount} to ${newCount}`);
    
    // Update the counter
    chrome.storage.local.set({ 'imagesFiltered': newCount }, function() {
      console.log("Image counter updated successfully");
      
      // Verify the update
      chrome.storage.local.get(['imagesFiltered'], function(result) {
        console.log(`New image counter value: ${result.imagesFiltered}`);
      });
    });
  });
}

// Run the test
incrementImageCounter();