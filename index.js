const express = require("express");
const axios = require("axios");
const CryptoJS = require("crypto-js");
const cors = require("cors");
const { sendEmail } = require('./mailer');
require('dotenv').config();
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
            redirectUrl: `${process.env.BASE_URL}/success/${transactionId}`,
            redirectMode: "POST",
            callbackUrl: `${process.env.BASE_URL}/api/v1/orders/callback/${transactionId}`,
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

router.post("/orders/callback/:transactionId", async (req, res) => {
    const transactionId = req.params.transactionId;
    console.log("Incoming request data:", req.body);
    const { formData, cartProducts } = req.body;

    try {
        console.log("Callback initiated for transaction:", transactionId);
        console.log("Request data:", { formData, cartProducts });

        if (!formData || !cartProducts) {
            return res.status(400).json({ status: "error", message: "Missing required data." });
        }

        let paymentStatus;
        do {
            const statusResponse = await checkPaymentStatus(transactionId);
            paymentStatus = statusResponse.data.status;
            console.log("Current payment status:", paymentStatus);
            if (paymentStatus === "PENDING") {
                console.log("Payment pending. Retrying in 5 seconds...");
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        } while (paymentStatus === "PENDING");

        if (paymentStatus !== "SUCCESS") {
            return res.status(400).json({ status: "error", message: "Payment failed", redirectUrl: process.env.FAILURE_URL });
        }

        console.log("Payment successful. Processing order update...");

        const responses = await Promise.all(
            requests.map(async (data) => {
                try {
                    const response = await axios.post(process.env.SHEET_URL, data, {
                        headers: { "Content-Type": "application/json" }
                    });
                    return response;
                } catch (error) {
                    console.error("Error updating Excel sheet for item:", data, error.message);
                    throw error;
                }
            })
        );

        const allSuccessful = responses.every(response => response.status === 200 || response.status === 201);
        if (allSuccessful) {
            await sendEmail(formData.email, 
                "Thank You for Your Purchase!", 
                `Dear ${formData.name},\n\nThank you for your purchase!`);
            res.status(200).json({ status: "success", redirectUrl: `${process.env.BASE_URL}/success/${transactionId} `});
        } else {
            throw new Error("Some items failed to update.");
        }

    } catch (error) {
        console.error("Error in callback:", error);
        res.status(500).json({ status: "error", message: "Internal server error while processing callback." });
    }
});


app.use("/api/v1", router);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});