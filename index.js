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

app.use((err, req, res, next) => {
    console.error("Global error:", err);
    res.status(500).json({
        status: "error",
        message: err.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? err : {}
    });
});

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
            redirectUrl: `https://infidiyas.com/success/${transactionId}`,
            redirectMode: "POST",
            callbackUrl: `https://infidiyas.com/api/v1/orders/callback/${transactionId}`,
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
            url: "https://api.phonepe.com/apis/hermes/pg/v1/pay",
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
            redirectUrl: `https://infidiyas.com/failure`
        });
    }
});

router.post("/orders/callback/:transactionId", async (req, res) => {
    const transactionId = req.params.transactionId;
    const { formData, cartProducts } = req.body;

    try {
        console.log("Received payment callback:", { transactionId, formData, cartProducts });

        const requests = cartProducts.map(cartItem => {
            return {
                TransactionId: transactionId,
                Name: formData.name,
                Email: formData.email,
                PhoneNumber: formData.phoneNumber,
                Address: formData.address,
                City: formData.city,
                Zip: formData.zip,
                ProductId: cartItem.productId,
                ProductName: cartItem.productName,
                Quantity: cartItem.quantity
            };
        });

        const responses = await Promise.all(
            requests.map(async (data) => {
                return axios.post("https://api.sheetbest.com/sheets/3fcaf326-2cbe-4a34-810d-2f8b442f48fa", data, {
                    headers: { "Content-Type": "application/json" }
                });
            })
        );

        const allSuccessful = responses.every(response => response.status === 200 || response.status === 201);
        if (allSuccessful) {
            const userEmail = formData.email;
            const userName = formData.name;
            const subject = "Thank You for Your Purchase!";
            const text = `Dear ${userName},\n\nThank you for your purchase! & Your transaction ID is ${transactionId}.\n\nWe Love You	&#128140;!\n\nBy,\nThe Mr.N`;

            await sendEmail(userEmail, subject, text);

            res.status(200).json({ status: "success", redirectUrl: `https://infidiyas.com/success/${transactionId}` });
        } else {
            throw new Error("Failed to update the Excel sheet for some items.");
        }

    } catch (error) {
        console.error("Error updating Excel sheet:", error);
        res.status(500).json({ status: "error", message: "Failed to update the Excel sheet." });
    }
});

app.use("/api/v1", router);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
