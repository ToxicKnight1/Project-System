const express = require('express');
const path = require('path');
const fs = require('fs');
const routes = require('./routes');
const aiRoutes = require('./ai');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use('/api', routes);
app.use('/api', aiRoutes);

// Serve the built React app (client/dist) in production.
// Hashed assets are cached forever; index.html must never be cached, so every
// page load picks up the current bundle after a deploy (stale HTML pointing at
// a deleted bundle renders a blank page).
const distDir = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));
  app.get(/^(?!\/api).*/, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

// JSON error handler (multer errors, unexpected failures)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

app.listen(PORT, () => console.log(`Portal running on http://localhost:${PORT}`));
