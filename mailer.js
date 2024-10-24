require('dotenv').config()
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
    service: 'Gmail',
    auth: {
        user: process.env.EMAILSERVICE_USER,
        pass: process.env.EMAILSERVICE_PASS  
    }
});

const sendEmail = (to, subject, text) => {
    const mailOptions = {
        from: process.env.EMAILSERVICE_USER,
        to,
        subject,
        text
    };

    return transporter.sendMail(mailOptions);
};

module.exports = { sendEmail };
