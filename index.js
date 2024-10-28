const express = require("express");
const axios = require("axios");
const CryptoJS = require("crypto-js");
const cors = require("cors");
const { sendEmail } = require('./mailer');
require('dotenv').config()
const app = express();
app.use(express.json());

app.use(cors({
    origin: ["https://infidiyas.com"],
    methods: ["GET", "POST", "PUT", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-VERIFY", "X-MERCHANT-ID", "Authorization"],
    credentials: true
}));

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

const corsOptions = {
    origin: 'https://infidiyas.com',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

router.post("/orders/callback/:transactionId",  cors(corsOptions), async (req, res) => {
    const transactionId = req.params.transactionId;
    const merchantId = process.env.MERCHANT_ID;
    const keyIndex = 1;
    const string = `/pg/v1/status/${merchantId}/${transactionId}` + process.env.KEY;
    const sha256 = crypto.createHash('sha256').update(string).digest('hex');
    const checksum = sha256 + "###" + keyIndex;

    const options = {
        method: 'GET',
        url: `https://api.phonepe.com/apis/hermes/pg/v1/status/${merchantId}/${transactionId}`,
        headers: {
            accept: 'application/json',
            'Content-Type': 'application/json',
            'X-VERIFY': checksum,
            'X-MERCHANT-ID': `${merchantId}`
        }
    };

    // CHECK PAYMENT STATUS
    axios.request(options).then(async (response) => {
        if (response.data.success === true) {
            console.log("Payment success:", response.data);

            // If payment is successful, proceed with updating Excel sheet and sending email
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

                // Update Excel sheet for all products in the cart
                const responses = await Promise.all(
                    requests.map(async (data) => {
                        return axios.post(process.env.SHEET_URL, data, {
                            headers: { "Content-Type": "application/json" }
                        });
                    })
                );

                const allSuccessful = responses.every(response => response.status === 200 || response.status === 201);
                if (allSuccessful) {
                    const userEmail = formData.email;
                    const userName = formData.name;
                    const subject = "Thank You for Your Purchase!";
                    const text = `Dear ${userName},\n\nThank you for your purchase! Your transaction ID is ${transactionId}.\n\nWe Love You ❣!\n\nBy,\nThe Mr.N`;

                    // Send confirmation email to the user
                    await sendEmail(userEmail, subject, text);

                    // Respond with success and redirect URL
                    return res.status(200).json({
                        status: "success",
                        redirectUrl: `${process.env.BASE_URL}/success/${transactionId}`
                    });
                } else {
                    throw new Error("Failed to update the Excel sheet for some items.");
                }

            } catch (error) {
                console.error("Error updating Excel sheet:", error);
                return res.status(500).json({
                    status: "error",
                    message: "Failed to update the Excel sheet."
                });
            }
        } else {
            // Payment failure
            console.log("Payment failed:", response.data);
            return res.status(400).json({
                status: "error",
                message: "Payment failure"
            });
        }
    }).catch((err) => {
        console.error("Error checking payment status:", err);
        return res.status(500).json({
            status: "error",
            message: err.message
        });
    });
});

app.use("/api/v1", router);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});