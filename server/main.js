const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

// Set up temporary storage for uploads
const upload = multer({
    dest: 'temp_uploads/',
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Ensure temp_uploads exists
if (!fs.existsSync('temp_uploads')) {
    fs.mkdirSync('temp_uploads');
}

app.post('/api/convert', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const inputPath = req.file.path;
    const outputDir = 'temp_uploads';
    const outputFileName = `${req.file.filename}.pdf`;
    const outputPath = path.join(outputDir, outputFileName);

    console.log(`Converting ${req.file.originalname} to PDF...`);

    // LibreOffice command to convert to PDF
    // Note: Assuming 'soffice' or 'libreoffice' is in the PATH
    const command = `soffice --headless --convert-to pdf --outdir ${outputDir} ${inputPath}`;

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error: ${error.message}`);
            // Cleanup input file
            fs.unlinkSync(inputPath);
            return res.status(500).json({ error: 'Conversion failed' });
        }

        if (fs.existsSync(outputPath)) {
            // Send file to client
            res.download(outputPath, `${path.parse(req.file.originalname).name}.pdf`, (err) => {
                // Cleanup files after download
                fs.unlinkSync(inputPath);
                fs.unlinkSync(outputPath);
                if (err) {
                    console.error('Download error:', err);
                } else {
                    console.log('Conversion and download successful.');
                }
            });
        } else {
            // Cleanup input file
            fs.unlinkSync(inputPath);
            res.status(500).json({ error: 'PDF not generated' });
        }
    });
});

app.listen(port, () => {
    console.log(`PINBRIDGE Secure Document Tools server running at http://localhost:${port}`);
});
