const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files from root directory
app.use(express.static(path.join(__dirname, '.')));

// API Routes
app.use('/api/voices', require('./api/voices'));
app.use('/api/tts', require('./api/tts'));
app.use('/api/stripe-webhook', require('./api/stripe-webhook'));

// Fallback to index.html for SPA/frontend routes if needed
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, () => {
  console.log(`VoiceAI server running live on port ${port}`);
});
