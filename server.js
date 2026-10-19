require('dotenv').config();

const express = require('express');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;
const ROOT_DIR = __dirname;

// Stripe webhook ko JSON middleware se pehle register karna zaroori hai.
app.post(
  '/api/stripe-webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      const stripeModule = await import(
        path.join(ROOT_DIR, 'api', 'stripe-webhook.js')
      );

      const handler =
        typeof stripeModule.default === 'function'
          ? stripeModule.default
          : stripeModule.handler;

      if (typeof handler !== 'function') {
        return res.status(500).json({
          error: 'Stripe webhook handler export is invalid.'
        });
      }

      return await handler(req, res);
    } catch (error) {
      console.error('Stripe webhook error:', error);
      return res.status(500).json({
        error: 'Stripe webhook failed to load.'
      });
    }
  }
);

// JSON/form middleware
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// API handlers ko dynamic import se load karo.
function mountHandler(route, file) {
  app.all(route, async (req, res) => {
    try {
      const loaded = await import(path.join(ROOT_DIR, file));

      const handler =
        typeof loaded.default === 'function'
          ? loaded.default
          : typeof loaded.handler === 'function'
            ? loaded.handler
            : null;

      if (!handler) {
        return res.status(500).json({
          error: 'API handler export is invalid.'
        });
      }

      return await handler(req, res);
    } catch (error) {
      console.error(`${route} error:`, error);
      return res.status(500).json({
        error: 'API failed to load. Check the server logs.'
      });
    }
  });
}

mountHandler('/api/voices', 'api/voices.js');
mountHandler('/api/tts', 'api/tts.js');

// Frontend static files
app.use(express.static(ROOT_DIR));

// Unknown API routes should return JSON, not index.html.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found.' });
});

// Frontend fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`VoiceAI server running on port ${port}`);
});
