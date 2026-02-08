'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory counters (reset on restart). For persistence, plug in a DB.
const stats = {
  totalVisits: 0,
  uniqueVisitors: 0,
};
const seenVisitorIds = new Set();

app.use(express.json());
app.use(cookieParser());

// Basic CORS support for optional cross-origin deployment.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  const allowedOrigins = allowedOrigin
    ? allowedOrigin.split(',').map((value) => value.trim()).filter(Boolean)
    : [];
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.sendStatus(204);
  }
  return next();
});

// Serve the static site from the repo root.
app.use(express.static(path.join(__dirname, '..')));

app.post('/api/visit', (req, res) => {
  let visitorId = req.cookies.vid;
  let isNew = false;

  if (!visitorId) {
    visitorId = crypto.randomUUID();
    isNew = true;
  } else if (!seenVisitorIds.has(visitorId)) {
    isNew = true;
  }

  stats.totalVisits += 1;
  if (isNew) {
    stats.uniqueVisitors += 1;
    seenVisitorIds.add(visitorId);
  }

  // One-year cookie
  res.cookie('vid', visitorId, {
    httpOnly: false,
    sameSite: 'Lax',
    maxAge: 1000 * 60 * 60 * 24 * 365,
  });

  return res.json({
    ok: true,
    totalVisits: stats.totalVisits,
    uniqueVisitors: stats.uniqueVisitors,
    newVisitor: isNew,
  });
});

app.get('/api/stats', (req, res) => {
  return res.json({
    totalVisits: stats.totalVisits,
    uniqueVisitors: stats.uniqueVisitors,
  });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on port ${PORT}`);
});
