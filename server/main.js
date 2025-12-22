const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const port = 3001;

const allowedOrigins = new Set(['http://localhost:3000', 'http://127.0.0.1:3000', 'null']);

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.has(origin)) {
            callback(null, true);
            return;
        }
        callback(new Error('CORS not allowed'));
    },
    methods: ['POST']
}));
app.use(express.json());
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    next();
});

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
    const outputDir = path.resolve('temp_uploads');
    const outputFileName = `${req.file.filename}.pdf`;
    const outputPath = path.join(outputDir, outputFileName);
    const ext = path.extname(req.file.originalname || '').toLowerCase();

    if (!['.doc', '.docx'].includes(ext)) {
        fs.unlinkSync(inputPath);
        return res.status(400).json({ error: 'Unsupported file type' });
    }

    console.log(`Converting ${req.file.originalname} to PDF...`);

    const cleanup = () => {
        try {
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        } catch (e) {
            console.warn('Cleanup failed', e);
        }
    };

    // LibreOffice command to convert to PDF
    // Note: Assuming 'soffice' or 'libreoffice' is in the PATH
    const command = 'soffice';
    const args = ['--headless', '--convert-to', 'pdf', '--outdir', outputDir, inputPath];
    const child = spawn(command, args, { stdio: 'ignore' });

    child.on('error', (error) => {
        console.error(`Error: ${error.message}`);
        cleanup();
        return res.status(500).json({ error: 'Conversion failed' });
    });

    child.on('close', (code) => {
        if (code !== 0) {
            console.error(`Conversion failed with code ${code}`);
            cleanup();
            return res.status(500).json({ error: 'Conversion failed' });
        }

        if (fs.existsSync(outputPath)) {
            res.download(outputPath, `${path.parse(req.file.originalname).name}.pdf`, (err) => {
                cleanup();
                if (err) {
                    console.error('Download error:', err);
                } else {
                    console.log('Conversion and download successful.');
                }
            });
        } else {
            cleanup();
            res.status(500).json({ error: 'PDF not generated' });
        }
    });
});

app.listen(port, () => {
    console.log(`PINBRIDGE Secure Document Tools server running at http://localhost:${port}`);
});
