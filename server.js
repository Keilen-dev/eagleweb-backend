const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory records (Use a persistent database like MongoDB or PostgreSQL for production)
let smsLogs = []; 
let activePasses = []; 

/**
 * 1. INBOUND SMS WEBHOOK ROUTE
 * Receives forwarded SMS payloads from your Android SMS Gateway app
 */
app.post('/api/incoming-sms', (req, res) => {
    const { message, sender } = req.body; 

    if (sender && sender.toUpperCase().includes('MPESA') && message) {
        // Extracts the 10-character alphanumeric transaction ID and amount
        const codeMatch = message.match(/^([A-Z0-9]{10})/); 
        const amountMatch = message.match(/Ksh([0-9,.]+)/i); 
        
        // Validates that the money went to your specific Till (1756916) or name
        const isTargetTill = message.includes('1756916') || message.toLowerCase().includes('cephas mutahi');

        if (codeMatch && amountMatch && isTargetTill) {
            const transactionId = codeMatch[1];
            const amount = parseFloat(amountMatch[1].replace(/,/g, ''));

            const exists = smsLogs.some(log => log.transactionId === transactionId);
            if (!exists) {
                smsLogs.push({
                    transactionId,
                    amount,
                    fullMessage: message,
                    isUsed: false,
                    timestamp: new Date()
                });
                console.log(`[TILL PAYMENT LOGGED] ID: ${transactionId}, Amount: ${amount}`);
            }
        }
    }

    res.status(200).json({ status: 'received' });
});

/**
 * 2. PAYMENT VERIFICATION ROUTE
 * Called automatically when the user submits their transaction ID on the website
 */
app.post('/api/verify-payment', (req, res) => {
    const { userPhone, transactionId, expectedAmount } = req.body;

    if (!userPhone || !transactionId) {
        return res.status(400).json({ success: false, message: "Missing phone number or transaction ID." });
    }

    const smsRecord = smsLogs.find(log => log.transactionId === transactionId);

    if (!smsRecord) {
        return res.status(400).json({ 
            success: false, 
            message: "Transaction ID not found. If you just paid, wait a few seconds and try again." 
        });
    }

    if (smsRecord.isUsed) {
        return res.status(400).json({ success: false, message: "This transaction ID has already been used." });
    }

    if (smsRecord.amount < expectedAmount) {
        return res.status(400).json({ success: false, message: `Amount mismatch. Expected KES ${expectedAmount}, found KES ${smsRecord.amount}.` });
    }

    // Mark code as spent so it cannot be reused
    smsRecord.isUsed = true;

    // Grant ticket pass access
    activePasses.push({
        userPhone,
        transactionId,
        amount: smsRecord.amount,
        grantedAt: new Date()
    });

    console.log(`[PASS GRANTED] Phone: ${userPhone} for Code: ${transactionId}`);

    return res.json({ 
        success: true, 
        message: "Payment verified successfully!" 
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
