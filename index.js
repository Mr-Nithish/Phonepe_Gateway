const express = require("express");
const axios = require("axios");
const CryptoJS = require("crypto-js");
const cors = require("cors");
const { sendEmail } = require('./mailer');
require('dotenv').config()
const app = express();

app.use(cors({
    origin: ["https://infidiyas.com"],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-VERIFY", "X-MERCHANT-ID"],
    credentials: true
}));

app.use(express.json());
const router = express.Router();

function generateTranscId() {
    return "T" + Date.now();
}

// Payment Initialization Endpoint
router.post("/payment", async (req, res) => {
    try {
        console.log("Received payment request:", req.body);

        if (!req.body.price) {
            return res.status(400).json({ status: "error", message: "Price is required" });
        }

        const price = parseFloat(req.body.price);
        if (isNaN(price) || price <= 0) {
            return res.status(400).json({ status: "error", message: "Invalid price value" });
        }

        const transactionId = generateTranscId();
        const data = {
            merchantId: process.env.MERCHANT_ID,
            merchantTransactionId: transactionId,
            merchantUserId: "MUID" + transactionId,
            amount: price * 100,
            redirectUrl: `https://phonepe-gateway.onrender.com/api/v1/payment/verify/:${transactionId}`, // Verification endpoint
            redirectMode: "POST",
            paymentInstrument: {
                type: "PAY_PAGE"
            }
        };

        const payload = JSON.stringify(data);
        const payloadMain = Buffer.from(payload).toString("base64");
        const key = process.env.KEY;
        const keyIndex = process.env.KEY_INDEX;
        const string = payloadMain + "/pg/v1/pay" + key;
        const sha256 = CryptoJS.SHA256(string).toString();
        const checksum = sha256 + "###" + keyIndex;

        const response = await axios({
            method: "POST",
            url: process.env.POD_URL,
            headers: {
                accept: "application/json",
                "Content-Type": "application/json",
                "X-VERIFY": checksum
            },
            data: { request: payloadMain },
            timeout: 10000
        });

        console.log("Payment API response:", response.data);

        if (!response.data || response.data.success !== true) {
            throw new Error("Payment initialization failed: " + JSON.stringify(response.data));
        }

        let redirectUrl;
        if (response.data.data) {
            const { instrumentResponse } = response.data.data;
            if (instrumentResponse && instrumentResponse.redirectInfo) {
                redirectUrl = instrumentResponse.redirectInfo.url;
            }
        }

        if (!redirectUrl) {
            throw new Error("No redirect URL found in response");
        }

        res.status(200).json({
            status: "success",
            message: "Payment initialized successfully",
            data: {
                redirectUrl,
                transactionId
            }
        });

    } catch (error) {
        console.error("Payment processing error:", error);
        res.status(error.response?.status || 500).json({
            status: "error",
            message: error.message || "Payment initialization failed",
            redirectUrl: process.env.FAILURE_URL
        });
    }
});

// Payment Verification Endpoint
router.post("/payment/verify/:transactionId", async (req, res) => {
    const transactionId = req.params.transactionId;

    try {
        console.log("Verifying payment:", transactionId);

        const merchantId = process.env.MERCHANT_ID;
        const keyIndex = process.env.KEY_INDEX;
        const key = process.env.KEY;
        const stringToHash = `/pg/v1/status/${merchantId}/${transactionId}` + key;
        const sha256 = CryptoJS.SHA256(stringToHash).toString();
        const checksum = sha256 + "###" + keyIndex;

        // Verify the payment status
        const statusResponse = await axios.get(`https://api.phonepe.com/apis/hermes/pg/v1/status/${merchantId}/${transactionId}`, {
            headers: {
                accept: 'application/json',
                'Content-Type': 'application/json',
                'X-VERIFY': checksum,
                'X-MERCHANT-ID': merchantId
            }
        });

        console.log("Payment status response:", statusResponse.data);

        if (statusResponse.data.success !== true) {
            return res.redirect(`${process.env.BASE_URL}/failure`);
        }

        // Payment successful, redirect to the success URL
        res.redirect(`${process.env.BASE_URL}/success/${transactionId}`);
    } catch (error) {
        console.error("Error verifying payment:", error);
        res.redirect(`${process.env.BASE_URL}/failure`);
    }
});

app.use("/api/v1", router);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});