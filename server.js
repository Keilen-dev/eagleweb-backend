const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();

// Middleware
app.use(express.json());
app.use(cors()); // Enables cross-origin requests from your live Vercel website

// --- DARAJA SANDBOX CREDENTIALS (Reading from Environment Variables) ---
const consumerKey = process.env.CONSUMER_KEY;
const consumerSecret = process.env.CONSUMER_SECRET;
const businessShortCode = process.env.BUSINESS_SHORTCODE || '174379'; 
const passkey = process.env.PASSKEY || 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919';

// 1. Generate Safaricom Access Token Middleware/Function
async function getAccessToken(req, res, next) {
    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
    try {
        const response = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
            headers: {
                'Authorization': `Basic ${auth}`
            }
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

        // Format phone number to 254XXXXXXXXX
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

        const stkPayload = {
            BusinessShortCode: businessShortCode,
            Password: password,
            Timestamp: timestamp,
            TransactionType: 'CustomerPayBillOnline',
            Amount: amount,
            PartyA: formattedPhone,
            PartyB: businessShortCode,
            PhoneNumber: formattedPhone,
            CallBackURL: 'https://mydomain.com/path', // Sandbox callback URL placeholder
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

        // Verify that Safaricom officially accepted and triggered the push ("0" means success)
        if (response.data.ResponseCode === "0") {
            return res.status(200).json({ success: true, data: response.data });
        } else {
            return res.status(400).json({ success: false, error: response.data });
        }

    } catch (error) {
        console.error('STK Push Error:', error.response?.data || error.message);
        return res.status(500).json({ success: false, error: error.response?.data || error.message });
    }
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
