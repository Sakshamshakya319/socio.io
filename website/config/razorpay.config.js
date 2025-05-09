const Razorpay = require('razorpay');
const dotenv = require('dotenv');
dotenv.config();

exports.createRazorpayInstance = () => {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    
    if (!keyId || !keySecret) {
        console.error('Razorpay API keys are missing. Please check your .env file.');
        throw new Error('Razorpay configuration error');
    }
    
    try {
        console.log('Creating Razorpay instance with key ID:', keyId);
        return new Razorpay({
            key_id: keyId,
            key_secret: keySecret,
        });
    } catch (error) {
        console.error('Error creating Razorpay instance:', error);
        throw error;
    }
}
