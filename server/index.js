'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory fallback (used only if DATABASE_URL is missing).
const stats = {
  totalVisits: 0,
  uniqueVisitors: 0,
};
const seenVisitorIds = new Set();

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
    })
  : null;

async function ensureTables() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS visit_stats (
      id integer PRIMARY KEY,
      total_visits bigint NOT NULL DEFAULT 0,
      unique_visitors bigint NOT NULL DEFAULT 0
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS visitors (
      id text PRIMARY KEY,
      first_seen timestamptz NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    INSERT INTO visit_stats (id, total_visits, unique_visitors)
    VALUES (1, 0, 0)
    ON CONFLICT (id) DO NOTHING;
  `);
}

ensureTables().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to initialize database tables:', err);
});

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

app.post('/api/visit', async (req, res) => {
  let visitorId = req.cookies.vid;
  let isNew = false;

  if (!visitorId) {
    visitorId = crypto.randomUUID();
    isNew = true;
  } else if (!seenVisitorIds.has(visitorId)) {
    isNew = true;
  }

  if (!pool) {
    stats.totalVisits += 1;
    if (isNew) {
      stats.uniqueVisitors += 1;
      seenVisitorIds.add(visitorId);
    }
  } else {
    try {
      const result = await pool.query(
        `
          WITH ins AS (
            INSERT INTO visitors (id)
            VALUES ($1)
            ON CONFLICT DO NOTHING
            RETURNING 1
          ),
          upd AS (
            UPDATE visit_stats
            SET total_visits = total_visits + 1,
                unique_visitors = unique_visitors + (SELECT COUNT(*) FROM ins)
            WHERE id = 1
            RETURNING total_visits, unique_visitors
          )
          SELECT
            total_visits,
            unique_visitors,
            (SELECT COUNT(*) FROM ins) AS new_visitor
          FROM upd;
        `,
        [visitorId]
      );
      if (result.rows.length > 0) {
        isNew = result.rows[0].new_visitor === 1;
        stats.totalVisits = Number(result.rows[0].total_visits);
        stats.uniqueVisitors = Number(result.rows[0].unique_visitors);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to update visit stats:', err);
      return res.status(500).json({ ok: false, error: 'stats_update_failed' });
    }
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

app.get('/api/stats', async (req, res) => {
  if (!pool) {
    return res.json({
      totalVisits: stats.totalVisits,
      uniqueVisitors: stats.uniqueVisitors,
    });
  }
  try {
    const result = await pool.query(
      'SELECT total_visits, unique_visitors FROM visit_stats WHERE id = 1;'
    );
    const row = result.rows[0] || { total_visits: 0, unique_visitors: 0 };
    stats.totalVisits = Number(row.total_visits);
    stats.uniqueVisitors = Number(row.unique_visitors);
    return res.json({
      totalVisits: stats.totalVisits,
      uniqueVisitors: stats.uniqueVisitors,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to read visit stats:', err);
    return res.status(500).json({ ok: false, error: 'stats_read_failed' });
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on port ${PORT}`);
});
