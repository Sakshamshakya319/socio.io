// Test script for image filtration
// This script can be run in the browser console to test image filtration

// Find all images on the page
function testImageFiltration() {
    console.log('Testing image filtration...');
    
    // Get all images on the page
    const images = document.querySelectorAll('img');
    console.log(`Found ${images.length} images on the page`);
    
    // Process each image
    images.forEach((img, index) => {
        console.log(`Processing image ${index + 1}/${images.length}: ${img.src}`);
        
        try {
            // Call the image processor directly
            const result = processImageElement(img);
            console.log(`Image ${index + 1} result:`, result);
        } catch (error) {
            console.error(`Error processing image ${index + 1}:`, error);
        }
    });
    
    console.log('Image filtration test complete');
}

// Run the test
testImageFiltration();