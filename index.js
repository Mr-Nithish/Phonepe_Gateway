const express = require("express");
const axios = require("axios");
const CryptoJS = require("crypto-js");
const cors = require('cors');
const app = express();

// Enhanced CORS configuration
app.use(cors({
    origin: ['https://infidiyas.com', 'https://api.phonepe.com'],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-VERIFY', 'X-MERCHANT-ID'],
    credentials: true
}));

app.use(express.json());

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Global error:', err);
    res.status(500).json({
        status: "error",
        message: err.message || "Internal server error",
        error: process.env.NODE_ENV === 'development' ? err : {}
    });
});

function generatedTranscId() {
    return 'T' + Date.now();
}

const router = express.Router();

router.post("/payment", async (req, res) => {
    try {
        console.log('Received payment request:', req.body);

        if (!req.body.price) {
            return res.status(400).json({
                status: "error",
                message: "Price is required"
            });
        }

        const price = parseFloat(req.body.price);
        if (isNaN(price) || price <= 0) {
            return res.status(400).json({
                status: "error",
                message: "Invalid price value"
            });
        }

        const transactionId = generatedTranscId();
        
        const data = {
            merchantId: "M225CKRAZD7WR",
            merchantTransactionId: transactionId,
            merchantUserId: "MUID" + transactionId,
            amount: price * 100,
            redirectUrl: `http://localhost:3001/api/v1/orders/status/${transactionId}`,
            redirectMode: "POST",
            callbackUrl: `http://localhost:3001/api/v1/orders/callback/${transactionId}`,
            paymentInstrument: {
                type: "PAY_PAGE"
            }
        };

        console.log('PhonePe request payload:', data);

        const payload = JSON.stringify(data);
        const payloadMain = Buffer.from(payload).toString("base64");
        const key = "e4406b88-f1d2-4652-8c0c-d2574f29294a";
        const keyIndex = 1;
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
            data: {
                request: payloadMain
            },
            timeout: 10000
        });

        console.log('PhonePe response:', response.data);

        if (!response.data || response.data.success !== true) {
            throw new Error('Payment initialization failed: ' + JSON.stringify(response.data));
        }

        // Extract redirect URL from response
        let redirectUrl;
        if (response.data.data && typeof response.data.data === 'string') {
            const decodedData = Buffer.from(response.data.data, 'base64').toString();
            const parsedData = JSON.parse(decodedData);
            redirectUrl = parsedData.redirectInfo?.url || parsedData.redirectUrl;
        } else if (response.data.data && response.data.data.instrumentResponse) {
            redirectUrl = response.data.data.instrumentResponse.redirectInfo.url;
        }

        if (!redirectUrl) {
            throw new Error('No redirect URL found in response');
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
        console.error('Payment processing error:', {
            message: error.message,
            response: error.response?.data,
            status: error.response?.status
        });

        // Send appropriate error response
        res.status(error.response?.status || 500).json({
            status: "error",
            message: error.response?.data?.message || error.message || "Payment initialization failed",
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

app.post('/api/v1/orders/status/:transactionId', (req, res) => {
    const transactionId = req.params.transactionId;
    console.log(`Checking status for transaction ID: ${transactionId}`);
    res.status(200).json({
        status: "success",
        message: `Status for transaction ID ${transactionId} retrieved successfully`
    });
});

app.use("/api/v1", router);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});