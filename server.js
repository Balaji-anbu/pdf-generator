require('dotenv').config();
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const drive = google.drive({
    version: 'v3',
    auth: new google.auth.GoogleAuth({
        keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
        scopes: ['https://www.googleapis.com/auth/drive.file']
    })
});

async function generateContent(title, details) {
    console.log('Generating content...');
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    
    const prompt = `
    Generate a structured document:
    Title: ${title}
    Details: ${details}
    
    Sections:
    - Introduction
    - Key Insights
    - Analysis
    - Conclusion
    Format professionally.
    `;
    
    const response = await model.generateContent(prompt);
    console.log('Content generated successfully');
    return response.response.text();
}

async function uploadToGoogleDrive(filePath, fileName) {
    console.log('Uploading to Google Drive...');
    const fileMetadata = { name: fileName };
    const media = {
        mimeType: 'application/pdf',
        body: fs.createReadStream(filePath)
    };
    
    try {
        const file = await drive.files.create({
            resource: fileMetadata,
            media,
            fields: 'id'
        });
        const fileId = file.data.id;
        
        await drive.permissions.create({
            fileId,
            requestBody: { type: 'anyone', role: 'reader' }
        });
        
        console.log('File uploaded to Google Drive with ID:', fileId);
        return `https://drive.google.com/uc?id=${fileId}`;
    } catch (error) {
        console.error('Error uploading to Google Drive:', error);
        throw error;
    }
}

app.post('/generate-pdf', async (req, res) => {
    const { title, details } = req.body;
    if (!title || !details) {
        return res.status(400).json({ error: 'Title and details are required' });
    }

    console.log('Received request to generate PDF with title:', title);
    
    try {
        const generatedContent = await generateContent(title, details);
        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: Arial, sans-serif; margin: 40px; }
                    h1 { color: #333; }
                </style>
            </head>
            <body>
                <h1>${title}</h1>
                ${generatedContent.replace(/\n/g, '<br>')}
            </body>
            </html>
        `;
        
        const browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.setContent(htmlContent);
        
        const filePath = path.join(__dirname, `${title.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
        await page.pdf({
            path: filePath,
            format: 'A4',
            margin: { top: '40px', right: '40px', bottom: '40px', left: '40px' }
        });
        
        await browser.close();
        
        const driveLink = await uploadToGoogleDrive(filePath, `${title}.pdf`);
        fs.unlinkSync(filePath);  // Delete local file after upload
        
        console.log('PDF generated and uploaded successfully. Drive link:', driveLink);
        res.json({ success: true, driveLink });
    } catch (error) {
        console.error('Error during PDF generation:', error);
        res.status(500).json({ 
            error: 'PDF generation failed',
            message: error.message
        });
    }
});

app.listen(3000, () => console.log('🚀 Server running on port 3000'));