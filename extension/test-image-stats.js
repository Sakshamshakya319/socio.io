// Test script for image stats
// This script can be run in the browser console to test image stats updating

// Function to manually update image stats
function testImageStats() {
    console.log('Testing image stats updating...');
    
    // Send a message to update image stats
    chrome.runtime.sendMessage({
        action: 'updateStats',
        type: 'image',
        count: 1
    }, function(response) {
        if (chrome.runtime.lastError) {
            console.error("Error updating stats:", chrome.runtime.lastError);
        } else {
            console.log("Stats updated successfully:", response);
        }
    });
}

// Function to check current stats
function checkCurrentStats() {
    console.log('Checking current stats...');
    
    chrome.storage.local.get(['textFiltered', 'imagesFiltered'], function(result) {
        console.log("Current stats:", result);
        console.log(`Text filtered: ${result.textFiltered || 0}`);
        console.log(`Images filtered: ${result.imagesFiltered || 0}`);
    });
}

// Run the tests
console.log('=== Image Stats Test ===');
checkCurrentStats();
testImageStats();
setTimeout(checkCurrentStats, 1000); // Check again after 1 second