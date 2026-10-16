const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();

// Middleware
app.use(express.json());
app.use(cors());

// --- DARAJA SANDBOX CREDENTIALS ---
const consumerKey = process.env.CONSUMER_KEY;
const consumerSecret = process.env.CONSUMER_SECRET;
const businessShortCode = process.env.BUSINESS_SHORTCODE || '174379'; 
const passkey = process.env.PASSKEY || 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919';

// Temporary memory store for tracking transaction results by CheckoutRequestID
const transactionStatuses = {};

// 1. Generate Safaricom Access Token Middleware
async function getAccessToken(req, res, next) {
    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
    try {
        const response = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
            headers: { 'Authorization': `Basic ${auth}` }
        });
        req.accessToken = response.data.access_token;
        next();
    } catch (error) {
        console.error('Access Token Error:', error.response?.data || error.message);
        return res.status(500).json({ success: false, error: 'Failed to generate access token from Safaricom.' });
    }
}

// 2. STK Push Endpoint
app.post('/api/stkpush', getAccessToken, async (req, res) => {
    try {
        const { phone, amount, courseName } = req.body;

        let formattedPhone = phone.toString().trim();
        if (formattedPhone.startsWith('0')) {
            formattedPhone = '254' + formattedPhone.slice(1);
        } else if (formattedPhone.startsWith('+')) {
            formattedPhone = formattedPhone.slice(1);
        }

        const date = new Date();
        const timestamp = date.getFullYear() +
            String(date.getMonth() + 1).padStart(2, '0') +
            String(date.getDate()).padStart(2, '0') +
            String(date.getHours()).padStart(2, '0') +
            String(date.getMinutes()).padStart(2, '0') +
            String(date.getSeconds()).padStart(2, '0');

        const password = Buffer.from(businessShortCode + passkey + timestamp).toString('base64');

        // IMPORTANT: Replace with your actual live Render backend URL for the callback
        const callbackUrl = `https://eagleweb-backend.onrender.com/api/callback`;

        const stkPayload = {
            BusinessShortCode: businessShortCode,
            Password: password,
            Timestamp: timestamp,
            TransactionType: 'CustomerPayBillOnline',
            Amount: amount,
            PartyA: formattedPhone,
            PartyB: businessShortCode,
            PhoneNumber: formattedPhone,
            CallBackURL: callbackUrl,
            AccountReference: 'Eagle Web Commerce',
            TransactionDesc: `Payment for ${courseName}`
        };

        const response = await axios.post(
            'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
            stkPayload,
            {
                headers: {
                    'Authorization': `Bearer ${req.accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (response.data.ResponseCode === "0") {
            const checkoutRequestId = response.data.CheckoutRequestID;
            // Mark initial state as pending
            transactionStatuses[checkoutRequestId] = { status: 'PENDING' };
            return res.status(200).json({ success: true, checkoutRequestId: checkoutRequestId });
        } else {
            return res.status(400).json({ success: false, error: response.data });
        }

    } catch (error) {
        console.error('STK Push Error:', error.response?.data || error.message);
        return res.status(500).json({ success: false, error: error.response?.data || error.message });
    }
});

// 3. Safaricom Callback Endpoint (Receives payment result when user enters PIN)
app.post('/api/callback', (req, res) => {
    try {
        const callbackData = req.body.Body.stkCallback;
        const checkoutRequestId = callbackData.CheckoutRequestID;
        const resultCode = callbackData.ResultCode;

        console.log("Callback received for:", checkoutRequestId, "ResultCode:", resultCode);

        if (resultCode === 0) {
            // Success! User entered PIN and money was paid.
            const metadata = callbackData.CallbackMetadata.Item;
            let mpesaReceiptNumber = "";
            
            metadata.forEach(item => {
                if (item.Name === "MpesaReceiptNumber") {
                    mpesaReceiptNumber = item.Value;
                }
            });

            transactionStatuses[checkoutRequestId] = {
                status: 'SUCCESS',
                receipt: mpesaReceiptNumber
            };
        } else {
            // User cancelled or failed
            transactionStatuses[checkoutRequestId] = {
                status: 'FAILED',
                message: callbackData.ResultDesc
            };
        }

        res.status(200).json({ received: true });
    } catch (error) {
        console.error("Callback Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// 4. Status Check Endpoint for Frontend
app.get('/api/payment-status/:checkoutRequestId', (req, res) => {
    const { checkoutRequestId } = req.params;
    const tx = transactionStatuses[checkoutRequestId];

    if (!tx) {
        return res.json({ status: 'PENDING' });
    }
    return res.json(tx);
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
