// Set image count script
// This script will set the image count to a specific value

// Set image count to a specific value
function setImageCount(count) {
  console.log(`Setting image count to ${count}...`);
  
  chrome.storage.local.set({
    'imagesFiltered': count
  }, function() {
    console.log(`Image count set to ${count}`);
    
    // Verify the update
    chrome.storage.local.get(['imagesFiltered'], function(result) {
      console.log(`Current image count: ${result.imagesFiltered}`);
    });
  });
}

// Run the script with count = 10
setImageCount(10);