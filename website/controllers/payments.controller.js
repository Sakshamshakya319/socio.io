const { createRazorpayInstance } = require("../config/razorpay.config");
const crypto = require("crypto");
require("dotenv").config();
const RazorpayInstance = createRazorpayInstance();

exports.createOrder = async (req,res) =>{
    // Set CORS headers specifically for this endpoint
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'POST');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Expose-Headers', 'x-rtb-fingerprint-id');
    
    //Do not collect amount from the client
    const {courseID, price} = req.body;

    // Validate input
    if (!courseID || !price || price <= 0) {
        return res.status(400).json({
            success: false,
            message: "Invalid input parameters"
        });
    }

    // Handle donation specifically
    const receiptId = courseID === 'donation' 
        ? `receipt_donation_${Date.now()}`
        : `receipt_order_${courseID}`;

    //create new order with additional parameters for better error handling
    const options = {
        amount: price * 100, // amount in the smallest currency unit
        currency: "INR",
        receipt: receiptId,
        notes: {
            purpose: "Donation to Socio.io",
            courseID: courseID
        }
    };

    try {
        RazorpayInstance.orders.create(options,(err,order)=>{
            if(err){
                console.error("Razorpay order creation error:", err);
                return res.status(500).json({
                    success: false,
                    message: "Payment gateway error",
                    error: err.error ? err.error.description : "Unknown error"
                });
            }
            return res.status(200).json(order);
        });
    } catch (error) {
        console.error("Exception in order creation:", error);
        return res.status(500).json({
            success: false,
            message: "Server error while processing payment",
            error: error.message
        });
    }
};

// Add error logging endpoint
exports.logError = async (req, res) => {
    // Set CORS headers
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'POST');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    
    const { error, timestamp } = req.body;
    
    // Log the error for debugging
    console.error('Client-side error:', timestamp, error);
    
    // In a production environment, you might want to save this to a database or log file
    
    return res.status(200).json({
        success: true,
        message: "Error logged"
    });
};

exports.verifyPayment = async (req,res) =>{
    // Set CORS headers specifically for this endpoint
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'POST');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Expose-Headers', 'x-rtb-fingerprint-id');
    
    const {order_id, payment_id, signature} = req.body;
    
    if (!order_id || !payment_id || !signature) {
        return res.status(400).json({
            success: false,
            message: "Missing required parameters"
        });
    }
    
    const secrect = process.env.RAZORPAY_KEY_SECRET;

    //create hmac object
    const hmac = crypto.createHmac("sha256", secrect);
    hmac.update(order_id + "|" + payment_id);

    const generatedSignature = hmac.digest("hex");
    //compare the generated signature with the received signature
    if(generatedSignature === signature){
        return res.status(200).json({
            success: true,
            message: "Payment verified successfully"
        });
    } else {
        return res.status(400).json({
            success: false,
            message: "Payment not verified"
        });
    }

};