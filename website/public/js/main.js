// Suppress specific console warnings related to Razorpay
const originalConsoleError = console.error;
console.error = function(msg) {
    // Ignore specific Razorpay-related warnings
    if (typeof msg === 'string' && 
        (msg.includes('Refused to get unsafe header') || 
         msg.includes('x-rtb-fingerprint-id'))) {
        return;
    }
    originalConsoleError.apply(console, arguments);
};

// Initialize Lucide icons
document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    
    // Mobile menu toggle
    const mobileMenuButton = document.getElementById('mobile-menu-button');
    const mobileMenu = document.getElementById('mobile-menu');
    const menuIcon = document.getElementById('menu-icon');
    const closeIcon = document.getElementById('close-icon');
    
    if (mobileMenuButton && mobileMenu && menuIcon && closeIcon) {
        mobileMenuButton.addEventListener('click', () => {
            mobileMenu.classList.toggle('hidden');
            menuIcon.classList.toggle('hidden');
            closeIcon.classList.toggle('hidden');
        });
    }
    
    // Download button functionality
    const downloadButton = document.getElementById('download-button');
    if (downloadButton) {
        downloadButton.addEventListener('click', () => {
            window.open(
                'https://github.com/Sakshamshakya319/Socio-io-extension/releases/download/socio.io/extension.zip',
                '_blank'
            );
            
            // Show donation modal after download starts
            const donationModal = document.getElementById('donation-modal');
            if (donationModal) {
                setTimeout(() => {
                    donationModal.classList.remove('hidden');
                }, 1000);
            }
        });
    }
    
    // Donation modal functionality
    const donationButton = document.getElementById('donation-button');
    const donationModal = document.getElementById('donation-modal');
    const closeDonation = document.getElementById('close-donation');
    
    if (donationButton && donationModal && closeDonation) {
        donationButton.addEventListener('click', () => {
            donationModal.classList.remove('hidden');
        });
        
        closeDonation.addEventListener('click', () => {
            donationModal.classList.add('hidden');
        });
    }
    
    // Donation amount selection
    const donationAmounts = document.querySelectorAll('.donation-amount');
    let selectedAmount = null;
    
    donationAmounts.forEach(button => {
        button.addEventListener('click', () => {
            // Remove active class from all buttons
            donationAmounts.forEach(btn => btn.classList.remove('active'));
            
            // Add active class to clicked button
            button.classList.add('active');
            
            // Set selected amount
            selectedAmount = button.getAttribute('data-amount');
            
            // Clear custom amount input
            const customAmountInput = document.getElementById('custom-amount');
            if (customAmountInput) {
                customAmountInput.value = '';
            }
        });
    });
    
    // Custom amount input
    const customAmountInput = document.getElementById('custom-amount');
    if (customAmountInput) {
        customAmountInput.addEventListener('input', (e) => {
            const value = e.target.value;
            if (/^\d*$/.test(value)) {
                // Remove active class from all buttons
                donationAmounts.forEach(btn => btn.classList.remove('active'));
                
                // Set selected amount to custom
                selectedAmount = 'custom';
            }
        });
    }
    
    // Donate button
    const donateButton = document.getElementById('donate-button');
    const paymentStatus = document.getElementById('payment-status');
    
    if (donateButton && paymentStatus) {
        donateButton.addEventListener('click', () => {
            let donationAmount;
            
            if (selectedAmount === 'custom') {
                donationAmount = customAmountInput.value;
            } else {
                donationAmount = selectedAmount;
            }
            
            if (!donationAmount || donationAmount <= 0) {
                paymentStatus.textContent = 'Please enter a valid amount';
                paymentStatus.classList.remove('hidden');
                paymentStatus.classList.add('bg-red-900/50', 'text-red-300');
                return;
            }

            // Show loading state
            donateButton.textContent = 'Processing...';
            donateButton.disabled = true;
            
            // Create Razorpay order with better error handling
            fetch('/api/createOrder', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    courseID: 'donation', // Using 'donation' as the courseID
                    price: parseInt(donationAmount)
                }),
            })
            .then(response => {
                if (!response.ok) {
                    return response.json().then(errorData => {
                        console.error('Order creation failed:', errorData);
                        throw new Error(errorData.message || 'Payment gateway error');
                    });
                }
                return response.json();
            })
            .then(order => {
                // Initialize Razorpay payment
                const options = {
                    key: 'rzp_live_PnrcXeyVhWCDmJ', // Using the key from .env file
                    amount: order.amount,
                    currency: order.currency,
                    name: 'Socio.io',
                    description: 'Donation to support Socio.io',
                    order_id: order.id,
                    handler: function (response) {
                        // Verify payment
                        fetch('/api/verifyPayment', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                order_id: order.id,
                                payment_id: response.razorpay_payment_id,
                                signature: response.razorpay_signature
                            }),
                        })
                        .then(response => response.json())
                        .then(data => {
                            if (data.success) {
                                // Payment successful
                                paymentStatus.textContent = 'Thank you for your donation!';
                                paymentStatus.classList.remove('hidden', 'bg-red-900/50', 'text-red-300');
                                paymentStatus.classList.add('bg-green-900/50', 'text-green-300');
                                
                                // Close the modal after a delay
                                setTimeout(() => {
                                    donationModal.classList.add('hidden');
                                    
                                    // Reset the form
                                    donationAmounts.forEach(btn => btn.classList.remove('active'));
                                    if (customAmountInput) {
                                        customAmountInput.value = '';
                                    }
                                    paymentStatus.classList.add('hidden');
                                    donateButton.textContent = 'Donate Now';
                                    donateButton.disabled = false;
                                }, 3000);
                            } else {
                                // Payment verification failed
                                paymentStatus.textContent = 'Payment verification failed. Please try again.';
                                paymentStatus.classList.remove('hidden', 'bg-green-900/50', 'text-green-300');
                                paymentStatus.classList.add('bg-red-900/50', 'text-red-300');
                                donateButton.textContent = 'Donate Now';
                                donateButton.disabled = false;
                            }
                        })
                        .catch(error => {
                            console.error('Error verifying payment:', error);
                            paymentStatus.textContent = 'Error verifying payment. Please try again.';
                            paymentStatus.classList.remove('hidden', 'bg-green-900/50', 'text-green-300');
                            paymentStatus.classList.add('bg-red-900/50', 'text-red-300');
                            donateButton.textContent = 'Donate Now';
                            donateButton.disabled = false;
                        });
                    },
                    prefill: {
                        name: '',
                        email: '',
                        contact: ''
                    },
                    theme: {
                        color: '#3B82F6'
                    },
                    modal: {
                        ondismiss: function() {
                            donateButton.textContent = 'Donate Now';
                            donateButton.disabled = false;
                        }
                    }
                };
                
                try {
                    const razorpayPayment = new Razorpay(options);
                    
                    // Add event listeners for potential errors
                    razorpayPayment.on('payment.failed', function(response) {
                        paymentStatus.textContent = 'Payment failed. Please try again.';
                        paymentStatus.classList.remove('hidden', 'bg-green-900/50', 'text-green-300');
                        paymentStatus.classList.add('bg-red-900/50', 'text-red-300');
                        donateButton.textContent = 'Donate Now';
                        donateButton.disabled = false;
                    });
                    
                    razorpayPayment.open();
                } catch (error) {
                    console.log('Razorpay initialization error:', error);
                    paymentStatus.textContent = 'Payment service error. Please try again later.';
                    paymentStatus.classList.remove('hidden', 'bg-green-900/50', 'text-green-300');
                    paymentStatus.classList.add('bg-red-900/50', 'text-red-300');
                    donateButton.textContent = 'Donate Now';
                    donateButton.disabled = false;
                }
            })
            .catch(error => {
                console.error('Error creating order:', error);
                
                // Check if it's a 500 Internal Server Error from Razorpay
                if (error.message && error.message.includes('500')) {
                    paymentStatus.textContent = 'Payment gateway is currently unavailable. Please try our alternative payment option below.';
                    
                    // Show fallback payment option
                    const fallbackPayment = document.getElementById('fallback-payment');
                    if (fallbackPayment) {
                        fallbackPayment.classList.remove('hidden');
                    }
                } else {
                    paymentStatus.textContent = 'Error creating payment: ' + error.message;
                }
                
                paymentStatus.classList.remove('hidden', 'bg-green-900/50', 'text-green-300');
                paymentStatus.classList.add('bg-red-900/50', 'text-red-300');
                donateButton.textContent = 'Donate Now';
                donateButton.disabled = false;
                
                // Log additional information for debugging
                fetch('/api/logError', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        error: error.toString(),
                        timestamp: new Date().toISOString()
                    }),
                }).catch(err => console.error('Failed to log error:', err));
            });
        });
    }
});