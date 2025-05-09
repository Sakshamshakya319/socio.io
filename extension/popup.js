// Popup script for Socio.io content moderation extension
document.addEventListener('DOMContentLoaded', function() {
    console.log("Popup loaded");
    
    // Get references to UI elements
    const toggleProtection = document.getElementById('toggleProtection');
    const statusText = document.getElementById('statusText');
    const textFiltered = document.getElementById('textFiltered');
    const imagesFiltered = document.getElementById('imagesFiltered');
    const historyBtn = document.getElementById('historyBtn');
    const recoverBtn = document.getElementById('recoverBtn');
    const historyContainer = document.getElementById('historyContainer');
    const historyList = document.getElementById('historyList');
    const recoveryContainer = document.getElementById('recoveryContainer');
    const encryptionFiles = document.getElementById('encryptionFiles');
    const recoveryResult = document.getElementById('recoveryResult');
    const recoveredText = document.getElementById('recoveredText');
    const backToMainBtn = document.getElementById('backToMainBtn');
    const resetStatsBtn = document.getElementById('resetStatsBtn');
  
    // Check if backend is available
    checkBackendConnection();
  
    // Load initial state
    loadStats();
    
    // Add reset stats functionality
    if (resetStatsBtn) {
      resetStatsBtn.addEventListener('click', function() {
        chrome.runtime.sendMessage({action: "resetStats"}, function(response) {
          if (response && response.success) {
            textFiltered.textContent = "0";
            imagesFiltered.textContent = "0";
          }
        });
      });
    }
    
    // Toggle protection
    toggleProtection.addEventListener('change', function() {
      const enabled = toggleProtection.checked;
      statusText.textContent = enabled ? 'ON' : 'OFF';
      
      // Save state
      chrome.storage.local.set({enabled: enabled}, function() {
        console.log("Protection state saved:", enabled);
      });
      
      // Notify content script - with error handling
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (tabs[0]) {
          try {
            chrome.tabs.sendMessage(
              tabs[0].id,
              {action: "toggleProtection", enabled: enabled},
              function(response) {
                console.log("Content script response:", response);
                
                // If we didn't get a response, the content script might not be loaded
                if (chrome.runtime.lastError) {
                  console.warn("Content script not ready:", chrome.runtime.lastError);
                }
              }
            );
          } catch (e) {
            console.error("Error sending message:", e);
          }
        }
      });
    });
    
    // History button click handler
    historyBtn.addEventListener('click', function() {
      historyContainer.classList.toggle('hidden');
      recoveryContainer.classList.add('hidden');
      
      if (!historyContainer.classList.contains('hidden')) {
        loadHistory();
      }
    });
    
    // Recovery button click handler
    recoverBtn.addEventListener('click', function() {
      recoveryContainer.classList.toggle('hidden');
      historyContainer.classList.add('hidden');
      
      if (!recoveryContainer.classList.contains('hidden')) {
        loadEncryptionFiles();
      }
    });
    
    // Back button (if exists)
    if (backToMainBtn) {
      backToMainBtn.addEventListener('click', function() {
        historyContainer.classList.add('hidden');
        recoveryContainer.classList.add('hidden');
      });
    }
    
    // Check backend connection
    function checkBackendConnection() {
      fetch('http://127.0.0.1:5000/api/status')
        .then(response => response.json())
        .then(data => {
          console.log("Backend connection successful:", data);
        })
        .catch(error => {
          console.error("Backend connection failed:", error);
          statusText.textContent = 'ERROR';
          statusText.style.color = 'red';
          
          const errorMessageElement = document.querySelector('.error-message') || document.createElement('div');
          errorMessageElement.className = 'error-message';
          errorMessageElement.textContent = 'Cannot connect to backend server. Make sure it\'s running on http://127.0.0.1:5000';
          
          if (!errorMessageElement.parentNode) {
            document.querySelector('.container').insertBefore(errorMessageElement, document.querySelector('.stats'));
          }
        });
    }
    
    // Load stats from storage
    function loadStats() {
      chrome.storage.local.get(['enabled', 'textFiltered', 'imagesFiltered'], function(result) {
        console.log("Loaded stats:", result);
        
        // Set toggle state
        toggleProtection.checked = result.enabled !== false;  // Default to true if not set
        statusText.textContent = toggleProtection.checked ? 'ON' : 'OFF';
        
        // Set counters with explicit conversion to number
        const textCount = parseInt(result.textFiltered) || 0;
        const imageCount = parseInt(result.imagesFiltered) || 0;
        
        // Update the DOM elements
        if (textFiltered) textFiltered.textContent = textCount;
        if (imagesFiltered) imagesFiltered.textContent = imageCount;
        
        console.log(`Stats updated - Text: ${textCount}, Images: ${imageCount}`);
        
        // Check content script status
        checkContentScriptStatus();
      });
    }
    
    // Force an immediate stats update when popup opens
    loadStats();
    
    // Set up periodic stats refresh (more frequent)
    setInterval(loadStats, 1000); // Refresh stats every second
    
    // Add a manual refresh button for testing
    const refreshStatsBtn = document.getElementById('refreshStatsBtn');
    if (refreshStatsBtn) {
      refreshStatsBtn.addEventListener('click', function() {
        console.log("Manual stats refresh requested");
        
        // Force a direct check of the storage
        chrome.storage.local.get(['textFiltered', 'imagesFiltered'], function(result) {
          console.log("Direct storage check:", result);
          
          // Update the UI
          const textCount = parseInt(result.textFiltered) || 0;
          const imageCount = parseInt(result.imagesFiltered) || 0;
          
          if (textFiltered) textFiltered.textContent = textCount;
          if (imagesFiltered) imagesFiltered.textContent = imageCount;
          
          console.log(`Stats manually updated - Text: ${textCount}, Images: ${imageCount}`);
          
          // Visual feedback that refresh happened
          refreshStatsBtn.textContent = "✓";
          setTimeout(() => {
            refreshStatsBtn.textContent = "↻";
          }, 1000);
        });
      });
    }
    
    // Check content script status
    function checkContentScriptStatus() {
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (tabs[0]) {
          try {
            chrome.tabs.sendMessage(
              tabs[0].id,
              {action: "checkStatus"},
              function(response) {
                if (chrome.runtime.lastError) {
                  console.warn("Content script not ready:", chrome.runtime.lastError);
                } else if (response) {
                  console.log("Content script status:", response);
                }
              }
            );
          } catch (e) {
            console.error("Error checking content script status:", e);
          }
        }
      });
    }
    
    // Load history from local storage
    function loadHistory() {
      console.log("Loading history from local storage");
      historyList.innerHTML = '<div class="loading">Loading history...</div>';
      
      chrome.storage.local.get(['filterHistory'], function(result) {
        const history = result.filterHistory || [];
        console.log("History data:", history);
        
        if (history.length === 0) {
          historyList.innerHTML = '<div class="history-item">No history found</div>';
          return;
        }
        
        historyList.innerHTML = '';
        
        history.forEach(item => {
          const historyItem = document.createElement('div');
          historyItem.className = 'history-item';
          
          // Format timestamp
          const timestamp = new Date(item.timestamp).toLocaleString();
          
          // Create flags from reasons
          const flags = item.reasons || ['Filtered content'];
          
          historyItem.innerHTML = `
            <div class="history-timestamp">${timestamp}</div>
            <div>Type: <span class="history-type">${item.type.toUpperCase()}</span></div>
            <div>Domain: <span class="history-domain">${item.domain || 'Unknown'}</span></div>
            <div>Flags: ${flags.join(', ') || 'None'}</div>
            <div class="history-content-preview">${item.content}</div>
          `;
          
          historyList.appendChild(historyItem);
        });
      });
    }
    
    // Load filtered text content for recovery
    function loadEncryptionFiles() {
      console.log("Loading filtered text content for recovery");
      encryptionFiles.innerHTML = '<div class="loading">Loading filtered text content...</div>';
      
      chrome.storage.local.get(['filterHistory'], function(result) {
        const history = result.filterHistory || [];
        
        // Filter to only include text items
        const textItems = history.filter(item => item.type === 'text');
        
        console.log("Filtered text items:", textItems);
        
        if (textItems.length === 0) {
          encryptionFiles.innerHTML = '<div class="encryption-file">No filtered text content found</div>';
          return;
        }
        
        encryptionFiles.innerHTML = '';
        
        // Group by domain
        const domainGroups = {};
        
        textItems.forEach((item, index) => {
          const domain = item.domain || 'Unknown';
          
          if (!domainGroups[domain]) {
            domainGroups[domain] = [];
          }
          
          domainGroups[domain].push({
            index: index,
            item: item
          });
        });
        
        // Create domain groups with clickable content items
        for (const domain in domainGroups) {
          const domainGroup = document.createElement('div');
          domainGroup.className = 'domain-group';
          
          // Create domain title
          const domainTitle = document.createElement('div');
          domainTitle.className = 'domain-title';
          domainTitle.textContent = domain;
          domainGroup.appendChild(domainTitle);
          
          // Add content items for this domain
          domainGroups[domain].forEach(entry => {
            const contentItem = document.createElement('div');
            contentItem.className = 'content-item';
            contentItem.dataset.index = entry.index;
            
            // Format timestamp
            const timestamp = new Date(entry.item.timestamp).toLocaleString();
            
            // Create preview
            const contentPreview = entry.item.content.substring(0, 50) + 
                                  (entry.item.content.length > 50 ? '...' : '');
            
            // Add content preview and timestamp
            contentItem.innerHTML = `
              <div class="content-preview">${contentPreview}</div>
              <div class="content-timestamp">${timestamp}</div>
            `;
            
            // Add click handler to select this item
            contentItem.addEventListener('click', function() {
              // Remove selected class from all items
              document.querySelectorAll('.content-item').forEach(item => {
                item.classList.remove('selected');
              });
              
              // Add selected class to this item
              contentItem.classList.add('selected');
              
              // Recover the content
              recoverEncryptedContent(entry.index);
            });
            
            domainGroup.appendChild(contentItem);
          });
          
          encryptionFiles.appendChild(domainGroup);
        }
      });
    }
    
    // Function to recover filtered text content
    function recoverEncryptedContent(index) {
      console.log("Recovering filtered text content, index:", index);
      
      if (!index && index !== 0) {
        recoveryResult.classList.remove('hidden');
        recoveredText.textContent = 'No content selected for recovery';
        return;
      }
      
      chrome.storage.local.get(['filterHistory'], function(result) {
        const history = result.filterHistory || [];
        const textItems = history.filter(item => item.type === 'text');
        
        if (textItems.length <= index) {
          recoveryResult.classList.remove('hidden');
          recoveredText.textContent = 'Selected content not found';
          return;
        }
        
        const selectedItem = textItems[index];
        
        // Show the recovery result
        recoveryResult.classList.remove('hidden');
        
        // Make sure we have the original content
        const originalContent = selectedItem.originalContent || selectedItem.content;
        
        // Display the recovered content
        recoveredText.textContent = originalContent;
        
        // Show recovery buttons
        const startRecoveryBtn = document.getElementById('startRecoveryBtn');
        const copyRecoveryBtn = document.getElementById('copyRecoveryBtn');
        
        if (startRecoveryBtn) {
          startRecoveryBtn.classList.remove('hidden');
          
          // Remove previous event listeners
          const newStartBtn = startRecoveryBtn.cloneNode(true);
          startRecoveryBtn.parentNode.replaceChild(newStartBtn, startRecoveryBtn);
          
          // Add new event listener
          newStartBtn.addEventListener('click', function() {
            // Make sure we have the original content
            const originalContent = selectedItem.originalContent || selectedItem.content;
            applyRecoveredContent(originalContent);
          });
        }
        
        if (copyRecoveryBtn) {
          copyRecoveryBtn.classList.remove('hidden');
          
          // Remove previous event listeners
          const newCopyBtn = copyRecoveryBtn.cloneNode(true);
          copyRecoveryBtn.parentNode.replaceChild(newCopyBtn, copyRecoveryBtn);
          
          // Add new event listener
          newCopyBtn.addEventListener('click', function() {
            // Make sure we have the original content
            const originalContent = selectedItem.originalContent || selectedItem.content;
            // Copy to clipboard
            navigator.clipboard.writeText(originalContent)
              .then(() => {
                // Show success message
                copyRecoveryBtn.textContent = 'Copied!';
                setTimeout(() => {
                  copyRecoveryBtn.textContent = 'Copy to Clipboard';
                }, 2000);
              })
              .catch(err => {
                console.error('Failed to copy text: ', err);
                copyRecoveryBtn.textContent = 'Copy Failed';
                setTimeout(() => {
                  copyRecoveryBtn.textContent = 'Copy to Clipboard';
                }, 2000);
              });
          });
        }
      });
    }
    
    // Apply recovered content
    function applyRecoveredContent(text) {
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (tabs[0]) {
          chrome.tabs.sendMessage(
            tabs[0].id,
            {action: "applyRecoveredContent", recoveredText: text},
            function(response) {
              if (chrome.runtime.lastError) {
                console.error("Error applying recovered content:", chrome.runtime.lastError);
                recoveryResult.textContent = 'Error: Content script not ready';
              } else {
                console.log("Content recovered response:", response);
                recoveryResult.textContent = 'Content applied to page successfully';
              }
            }
          );
        }
      });
    }
  });