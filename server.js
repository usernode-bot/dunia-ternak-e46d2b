const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const app = express();
const port = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// The platform signs user-identity tokens with an RSA private key it never
// shares. Containers get only the PUBLIC half, so this app can verify who a
// user is but cannot mint an identity — and neither can any other app.
const JWT_PUBLIC_KEY = (process.env.USERNODE_JWT_PUBLIC_KEY || '')
  .replace(/\\n/g, '\n');

// Tokens are minted for one app: the audience is this app's numeric id, so a
// token issued for a different app is rejected below rather than accepted as
// a valid user.
const APP_AUDIENCE = process.env.USERNODE_APP_ID
  ? 'usernode:app:' + process.env.USERNODE_APP_ID
  : null;

// Visitors with no Homeroom account ("guests") may look around this app at
// its own address, read-only (every public app). The platform marks
// them with a token of their own: ES256, signed by a key of its own (its
// public half is USERNODE_GUEST_JWT_PUBLIC_KEY), this audience, `pur:
// 'guest'`, `guest: true`, and no id or username. Such a visitor is
// `req.guest`, never `req.user`, and every write they try is answered 401
// `account_required`, which the bridge turns into "Make an account to
// continue".
const GUEST_AUDIENCE = APP_AUDIENCE ? APP_AUDIENCE + ':guest' : null;
const GUEST_PUBLIC_KEY = (process.env.USERNODE_GUEST_JWT_PUBLIC_KEY || '')
  .replace(/\\n/g, '\n');

// Paths that stay open without authentication. Add a path here (and add it
// with `app.get`/`app.post` below) if you deliberately want it public.
// Everything else requires a valid platform-issued JWT.
const PUBLIC_API_PATHS = new Set(['/health']);

app.use(express.json());

// The platform's three centrally hosted files — the bridge, the native UI
// kit and the Tailwind runtime — are reachable at these paths on this app's
// OWN origin, so index.html can load them with a RELATIVE path and never
// name the platform's hostname. A hostname baked into an app is what breaks
// every app at once when the platform's domain moves.
//
// In production and on a staging preview the platform's edge answers these
// before the request ever reaches this process (a per-app Ingress rule on
// Kubernetes, the wildcard site's matcher on the docker runtime). This
// handler is what makes the same relative paths work under a plain
// `node server.js`, where there is no edge in front of the app at all.
//
// Registered BEFORE the auth middleware because these three files are
// public: the platform serves them anonymously from any app origin, and a
// login redirect arriving where a <script> was expected is exactly the
// failure a relative path is meant to avoid.
// The platform's origin, at RUNTIME, and ONLY from the variable the platform
// injects. No hostname is written into this file: a baked-in one is what left
// the whole fleet pointing at a domain the platform had moved away from.
// Unset only outside the platform (a plain local `node server.js`) — set
// USERNODE_PLATFORM_ORIGIN there too if you want the hosted assets locally.
const PLATFORM_ORIGIN = (process.env.USERNODE_PLATFORM_ORIGIN || '')
  .replace(/\/+$/, '');
// This project's address on the platform (/app/<slug>), from the variable the
// platform injects, and not written in here either: every project made from
// the same starter is then the same code. Unset only outside the platform.
const APP_SLUG = process.env.USERNODE_APP_SLUG || '';

app.get(/^\/usernode-(?:bridge|native|tailwind)\//, async (req, res) => {
  try {
    if (!PLATFORM_ORIGIN) return res.sendStatus(503);
    const upstream = await fetch(PLATFORM_ORIGIN + req.path);
    if (!upstream.ok) return res.sendStatus(upstream.status);
    const type = upstream.headers.get('content-type');
    if (type) res.type(type);
    // max-age=0 with revalidation, never a long TTL: the whole point of
    // central hosting is that a platform-side fix lands on the next load.
    res.set('Cache-Control', 'public, max-age=0, must-revalidate');
    return res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.warn('hosted asset fetch failed: ' + err.message);
    return res.sendStatus(502);
  }
});

// Homeroom's requests about one person's data: erase it when they delete
// their account, export it when they ask for a copy. Mounted BEFORE the
// sign-in check because they carry a platform token of their own, which
// usernode-user-data.js verifies. When you add a table, check that file's
// OWNED_BY and SKIP lists ("Your people's data" in the platform conventions).
require('./usernode-user-data').mount(app, pool);

// "Now" for this request, as a Date: `req.now`, set for every request by
// the middleware below. Read the day and the time through it (and
// `usernode.now()` in the page), never `new Date()` or SQL's NOW(),
// wherever they decide what shows: a reminder, a rota, a deadline.
// Production always gets the real time. A staging preview may be shown as of
// a chosen moment: the platform opens it with `?un-now=<ISO time>`, and the
// page sends `usernode.now()` on as the `x-usernode-now` header. Only a
// staging container reads either. See "Time-dependent features" in the
// platform conventions.
const IS_STAGING = process.env.USERNODE_ENV === 'staging';
const PREVIEW_NOW = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
function requestNow(req) {
  const raw = IS_STAGING ? (req.headers['x-usernode-now'] || req.query['un-now']) : null;
  return typeof raw === 'string' && PREVIEW_NOW.test(raw) ? new Date(raw) : new Date();
}

// Verify platform-issued JWT if one was passed, then enforce auth on
// anything not explicitly marked public. The iframe adds `?token=…`
// on load; the frontend script forwards the token via `x-usernode-token`
// on subsequent fetches.
app.use((req, res, next) => {
  req.now = requestNow(req);
  const token = req.query.token || req.headers['x-usernode-token'];
  if (token && JWT_PUBLIC_KEY && APP_AUDIENCE) {
    try {
      // Pin the algorithm, issuer and audience. Without `algorithms` a
      // caller could hand us an HS256 token signed with the public PEM
      // (which every app knows) and forge any user.
      const claims = jwt.verify(token, JWT_PUBLIC_KEY, {
        algorithms: ['RS256'],
        issuer: 'usernode',
        audience: APP_AUDIENCE,
      });
      // `pur` names what the token is for. Only user-identity tokens
      // authenticate a person here.
      if (claims && claims.pur === 'iframe') req.user = claims;
    } catch {}
  }
  if (!req.user && token && GUEST_PUBLIC_KEY && GUEST_AUDIENCE) {
    try {
      const guest = jwt.verify(token, GUEST_PUBLIC_KEY, {
        algorithms: ['ES256'],
        issuer: 'usernode',
        audience: GUEST_AUDIENCE,
      });
      if (guest && guest.pur === 'guest' && guest.guest === true) req.guest = true;
    } catch {}
  }

  // Static assets (CSS/JS/images) are always served; the API and the HTML
  // shell are gated so direct hits to the staging/prod subdomain don't
  // leak app data to the public internet. A guest may READ: every GET,
  // `/api/*` included, so read routes must not assume req.user (use
  // `req.user ? req.user.id : null`). Every write needs an account.
  if (req.method !== 'GET' || req.path.startsWith('/api/')) {
    if (PUBLIC_API_PATHS.has(req.path)) return next();
    if (!req.user && req.guest) {
      if (req.method === 'GET' || req.method === 'HEAD') return next();
      return res.status(401).json({ error: 'account_required' });
    }
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// The template ships no favicon file; index.html carries an inline SVG
// icon instead. Answer 204 here so anything that still probes
// /favicon.ico (older browsers, direct visits) doesn't fall through to
// the auth-gated catch-all and surface a 401 in the console on every
// fresh load.
app.get('/favicon.ico', (_req, res) => res.status(204).end());

// ── Forum data ──────────────────────────────────────────────────────────────
// One shared forum: every signed-in farmer sees everybody's questions.
// A guest may read (mode "public" tables), but writing needs an account.
const CATEGORIES = new Set(['sapi', 'kambing', 'ayam', 'umum']);

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS forum_posts (
      id serial PRIMARY KEY,
      user_id text NOT NULL,
      nickname text NOT NULL,
      category text NOT NULL,
      title text NOT NULL,
      body text NOT NULL,
      is_demo boolean NOT NULL DEFAULT false,
      demo_key text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS forum_posts_owner_demo
      ON forum_posts (user_id, demo_key);
    CREATE TABLE IF NOT EXISTS forum_replies (
      id serial PRIMARY KEY,
      post_id integer NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
      user_id text NOT NULL,
      nickname text NOT NULL,
      body text NOT NULL,
      is_demo boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS forum_replies_post ON forum_replies (post_id);
    ALTER TABLE forum_posts   ADD COLUMN IF NOT EXISTS photo_url text;
    ALTER TABLE forum_posts   ADD COLUMN IF NOT EXISTS photo_id  text;
    ALTER TABLE forum_replies ADD COLUMN IF NOT EXISTS photo_url text;
    ALTER TABLE forum_replies ADD COLUMN IF NOT EXISTS photo_id  text;
    CREATE TABLE IF NOT EXISTS forum_reports (
      id serial PRIMARY KEY,
      user_id text NOT NULL,
      kind text NOT NULL,
      target_id integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    COMMENT ON TABLE forum_reports IS 'staging:private';

    CREATE TABLE IF NOT EXISTS animals (
      id serial PRIMARY KEY,
      user_id text NOT NULL,
      name text NOT NULL,
      kind text NOT NULL,
      age_months integer,
      photo_url text,
      photo_id text,
      last_vaccine_on date,
      last_deworm_on date,
      mated_on date,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS animals_owner ON animals (user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS animal_weights (
      id serial PRIMARY KEY,
      animal_id integer NOT NULL REFERENCES animals(id) ON DELETE CASCADE,
      user_id text NOT NULL,
      weighed_on date NOT NULL,
      chest_cm numeric(5,1),
      body_length_cm numeric(5,1),
      weight_kg numeric(6,1) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS animal_weights_animal ON animal_weights (animal_id, weighed_on);
    CREATE TABLE IF NOT EXISTS animal_notes (
      id serial PRIMARY KEY,
      animal_id integer NOT NULL REFERENCES animals(id) ON DELETE CASCADE,
      user_id text NOT NULL,
      kind text NOT NULL,
      note_date date NOT NULL,
      body text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS animal_notes_animal ON animal_notes (animal_id, note_date DESC);
    -- One farmer's animals, their weights and their health notes are nobody
    -- else's business: staging gets the schema but not the rows.
    COMMENT ON TABLE animals IS 'staging:private';
    COMMENT ON TABLE animal_weights IS 'staging:private';
    COMMENT ON TABLE animal_notes IS 'staging:private';
  `);
}

// Trimmed, length-checked text from a request body, or null when it is not
// usable. A title, a body or a nickname that is too long is an error rather
// than silently cut short.
function textField(value, max, min) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text.length < (min || 1) || text.length > max) return null;
  return text;
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : value;
}

// A photo is stored as the URL and id the platform's file storage returned
// (usernode.uploadFile). Image bytes never reach this database. Only a URL on
// the platform's own /app-files/<id> path is accepted, so a client cannot
// point the forum at some other host.
function appFileId(url) {
  if (typeof url !== 'string' || !url) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const allowed = new Set(['https:']);
  if (PLATFORM_ORIGIN) {
    try {
      allowed.add(new URL(PLATFORM_ORIGIN).protocol);
    } catch {}
  }
  if (!allowed.has(parsed.protocol)) return null;
  if (PLATFORM_ORIGIN) {
    try {
      if (parsed.host !== new URL(PLATFORM_ORIGIN).host) return null;
    } catch {}
  }
  const match = /^\/app-files\/([0-9a-f]{32})$/.exec(parsed.pathname);
  return match ? match[1] : null;
}

// `null` when no photo was sent, `{ url, id }` when it is usable, `false` when
// the client sent something that is not a platform file.
function photoFields(body) {
  const rawUrl = body && body.photo_url;
  const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  const rawId = body && body.photo_id;
  const id = typeof rawId === 'string' ? rawId.trim() : '';
  if (!url && !id) return null;
  if (!/^[0-9a-f]{32}$/.test(id)) return false;
  if (appFileId(url) !== id) return false;
  return { url, id };
}

// ── Ternakku: a farmer's animal records ─────────────────────────────────────
// These rows belong to one Homeroom account. Every route below reads them by
// user_id, so nobody can open another farmer's animal.
const ANIMAL_KINDS = new Set(['sapi', 'kambing', 'domba', 'ayam']);
const NOTE_KINDS = new Set(['harian', 'sakit', 'obat']);

// A date-only value ("2026-10-22"), or null when nothing was sent. `false`
// means something was sent that is not a real calendar day.
function dayField(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return false;
  return value;
}

function intField(value, min, max) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : false;
}

// The farmer's own day. This app's farmers are in Indonesia, so reminders and
// the default date of a new record use Asia/Jakarta (WIB), not the container's
// UTC clock: at 05:00 WIB the UTC day is still yesterday.
const JAKARTA_DAY = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
});
function todayJakarta(now) {
  const parts = {};
  for (const part of JAKARTA_DAY.formatToParts(now)) parts[part.type] = part.value;
  return parts.year + '-' + parts.month + '-' + parts.day;
}

function animalJson(row) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    age_months: row.age_months === null ? null : Number(row.age_months),
    photo_url: row.photo_url || null,
    photo_id: row.photo_id || null,
    last_vaccine_on: row.last_vaccine_on || null,
    last_deworm_on: row.last_deworm_on || null,
    mated_on: row.mated_on || null,
    latest_weight_kg: row.latest_weight_kg === undefined || row.latest_weight_kg === null
      ? null : Number(row.latest_weight_kg),
    latest_weighed_on: row.latest_weighed_on || null,
    created_at: iso(row.created_at),
  };
}

const ANIMAL_SELECT = `
  SELECT a.id, a.name, a.kind, a.age_months, a.photo_url, a.photo_id,
         to_char(a.last_vaccine_on, 'YYYY-MM-DD') AS last_vaccine_on,
         to_char(a.last_deworm_on,  'YYYY-MM-DD') AS last_deworm_on,
         to_char(a.mated_on,        'YYYY-MM-DD') AS mated_on,
         a.created_at,
         w.weight_kg AS latest_weight_kg,
         to_char(w.weighed_on, 'YYYY-MM-DD') AS latest_weighed_on
    FROM animals a
    LEFT JOIN LATERAL (
      SELECT weight_kg, weighed_on FROM animal_weights
       WHERE animal_id = a.id
       ORDER BY weighed_on DESC, id DESC
       LIMIT 1
    ) w ON true`;

async function ownedAnimal(id, userId) {
  if (!Number.isInteger(id) || id <= 0) return null;
  const { rows } = await pool.query(
    ANIMAL_SELECT + ' WHERE a.id = $1 AND a.user_id = $2',
    [id, userId]
  );
  return rows[0] || null;
}

// The same two formulas the quick "Estimasi berat" tool uses: Schoorl for
// cattle, Lambourne for goats and sheep. A chicken has no chest formula, so
// its weight comes from a scale.
function estimateWeight(kind, chest, length) {
  if (kind === 'sapi') return Math.pow(chest + 22, 2) / 100;
  return (chest * chest * length) / 10840;
}

// Staging seed: obviously fake farmers and questions, so the populated
// forum can be seen. Fixed demo keys make it idempotent; none of it is
// shown unless the staging preview is opened with ?demo=1.
const DEMO_HOURS = (h) => new Date(Date.now() - Math.round(h * 3600_000));

// A drawn sample photo for the staging demo, as a data URI: platform files are
// not cloned into staging, so a demo row cannot point at a real /app-files/ URL.
const DEMO_PHOTO = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200">' +
  '<rect width="320" height="200" fill="#c9dcb4"/><rect y="138" width="320" height="62" fill="#86a865"/>' +
  '<ellipse cx="170" cy="112" rx="72" ry="36" fill="#efe9dc"/><ellipse cx="170" cy="96" rx="40" ry="12" fill="#d9cdb6"/>' +
  '<rect x="118" y="132" width="11" height="40" rx="4" fill="#e3dccd"/><rect x="140" y="136" width="11" height="38" rx="4" fill="#e3dccd"/>' +
  '<rect x="194" y="136" width="11" height="38" rx="4" fill="#e3dccd"/><rect x="216" y="132" width="11" height="40" rx="4" fill="#e3dccd"/>' +
  '<path d="M96 98 L78 70 L100 62 L114 92 Z" fill="#efe9dc"/>' +
  '<path d="M84 66 L76 50 M96 62 L94 46" stroke="#8c7a5c" stroke-width="4" stroke-linecap="round"/>' +
  '<text x="160" y="190" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#3d4a2f">Foto contoh</text>' +
  '</svg>'
);
const DEMO_POSTS = [
  {
    key: 'p1', user: 'demo:pak-contoh', nick: 'Pak Contoh', cat: 'kambing', hours: 2,
    title: 'Kambing saya tidak mau makan sejak kemarin',
    body: 'Umur 1 tahun, perut agak besar sebelah kiri. Minum masih mau. Apa perlu panggil mantri?',
    replies: [
      { user: 'demo:bu-uji', nick: 'Bu Uji Coba', hours: 1, body: 'Kalau perut kiri kembung, cepat hubungi dokter hewan. Jangan diberi makan rumput basah dulu.' },
      { user: 'demo:mas-sampel', nick: 'Mas Sampel', hours: 0.7, body: 'Setuju, kembung bisa cepat parah. Sambil menunggu, ajak kambing berjalan pelan.' },
    ],
  },
  {
    key: 'p2', user: 'demo:kang-demo', nick: 'Kang Demo', cat: 'ayam', hours: 26,
    title: 'Ayam kampung mengantuk dan jengger pucat',
    body: 'Tiga ekor dari 20 mulai lemas, nafsu makan turun. Apakah tanda cacingan atau penyakit lain?',
    replies: [
      { user: 'demo:bu-uji', nick: 'Bu Uji Coba', hours: 24, body: 'Pisahkan yang lemas dulu. Kalau ada kematian mendadak, laporkan ke dinas peternakan.' },
      { user: 'demo:pak-contoh', nick: 'Pak Contoh', hours: 20, body: 'Saya pernah seperti ini, ternyata cacing. Lebih aman periksa kotoran ke mantri.' },
      { user: 'demo:mas-sampel', nick: 'Mas Sampel', hours: 18, body: 'Cek juga kandangnya, kalau lembap ayam gampang sakit.' },
    ],
  },
  {
    key: 'p3', user: 'demo:ibu-fiktif', nick: 'Ibu Fiktif', cat: 'ayam', hours: 70,
    title: 'Suhu mesin tetas berapa derajat?',
    body: 'Mesin tetas sederhana dari kotak kayu. Berapa suhu dan kelembapan yang aman untuk telur ayam kampung?',
    replies: [],
  },
  {
    key: 'p4', user: 'demo:pak-contoh', nick: 'Pak Contoh', cat: 'sapi', hours: 30,
    title: 'Sapi perah susunya turun setelah hujan',
    body: 'Dua hari hujan terus, susu turun dari 9 liter jadi 6 liter. Pakan tetap sama. Apa penyebabnya?',
    replies: [
      { user: 'demo:kang-demo', nick: 'Kang Demo', hours: 22, body: 'Sapi perah sensitif ke perubahan cuaca. Pastikan kandang tidak bocor dan air minum bersih.' },
    ],
  },
  {
    key: 'p5', user: 'demo:bu-uji', nick: 'Bu Uji Coba', cat: 'sapi', hours: 5,
    title: 'Berapa hijauan per hari untuk sapi 250 kg?',
    body: 'Sapi bakalan 250 kg. Saya kasih rumput gajah dua kali sehari, kira-kira berapa banyak yang cukup?',
    replies: [
      { user: 'demo:mas-sampel', nick: 'Mas Sampel', hours: 4, body: 'Umumnya sekitar 10 persen dari bobot badan per hari, jadi sekitar 25 kg hijauan segar. Tambah mineral.' },
    ],
  },
  {
    key: 'p6', user: 'demo:mas-sampel', nick: 'Mas Sampel', cat: 'kambing', hours: 8,
    title: 'Anak kambing umur 2 minggu diare',
    body: 'Anak kambing masih menyusu, kotorannya cair sejak pagi. Apa yang pertama harus dilakukan?',
    replies: [
      { user: 'demo:ibu-fiktif', nick: 'Ibu Fiktif', hours: 6, body: 'Jaga jangan sampai dehidrasi, beri air bersih. Kalau lemas, segera panggil dokter hewan.' },
      { user: 'demo:pak-contoh', nick: 'Pak Contoh', hours: 5, body: 'Pisahkan dari induk lain dulu supaya tidak menular.' },
    ],
  },
  {
    key: 'p7', user: 'demo:bu-uji', nick: 'Bu Uji Coba', cat: 'umum', hours: 50,
    title: 'Cara menyimpan jerami kering dan katul',
    body: 'Musim panen, saya mau simpan pakan untuk musim kemarau. Bagaimana supaya tidak berjamur?',
    replies: [
      { user: 'demo:kang-demo', nick: 'Kang Demo', hours: 45, body: 'Simpan di tempat kering yang ada anginnya, alas kayu supaya tidak lembap dari lantai.' },
    ],
  },
  {
    key: 'p8', user: 'demo:pak-contoh', nick: 'Pak Contoh', cat: 'umum', hours: 140,
    title: 'Kandang bau, pakai sekam atau kapur?',
    body: 'Kandang kambing di belakang rumah baunya kuat. Lebih baik pakai sekam atau tabur kapur tiap hari?',
    replies: [
      { user: 'demo:ibu-fiktif', nick: 'Ibu Fiktif', hours: 130, body: 'Sekam yang diganti rutin lebih aman. Kapur boleh sesekali, jangan sampai berdebu tebal.' },
    ],
  },
  {
    key: 'p9', user: 'demo:ibu-fiktif', nick: 'Ibu Fiktif', cat: 'kambing', hours: 1,
    title: 'Bulu kambing rontok di punggung, kenapa ya?',
    body: 'Kulitnya tidak luka, kambing masih mau makan. Apa karena kutu atau pakan?',
    photo: DEMO_PHOTO,
    replies: [
      { user: 'demo:bu-uji', nick: 'Bu Uji Coba', hours: 0.5, body: 'Bisa karena kutu atau jamur. Periksa ke mantri supaya tahu pastinya, dan jaga kandang tetap kering.' },
    ],
  },
];

const OWN_DEMO_POST = {
  category: 'sapi',
  title: 'Sapi sudah 3 bulan setelah IB, bagaimana tahu bunting?',
  body: 'Sapi IB awal bulan tiga bulan lalu. Belum ada tanda birahi lagi. Apa cukup dilihat atau perlu periksa ke mantri?',
  reply: { user: 'demo:kang-demo', nick: 'Kang Demo', hours: 20, body: 'Biasanya dicek dengan palpasi oleh mantri sekitar 60 hari setelah IB. Kalau belum pernah, sebaiknya periksa.' },
};

async function seedDemoForum() {
  for (const p of DEMO_POSTS) {
    const when = DEMO_HOURS(p.hours);
    const inserted = await pool.query(
      `INSERT INTO forum_posts (user_id, nickname, category, title, body, is_demo, demo_key, created_at, photo_url)
       VALUES ($1,$2,$3,$4,$5,true,$6,$7,$8)
       ON CONFLICT (user_id, demo_key) DO NOTHING
       RETURNING id`,
      [p.user, p.nick, p.cat, p.title, p.body, p.key, when, p.photo || null]
    );
    let postId = inserted.rows[0] && inserted.rows[0].id;
    if (!postId) {
      const found = await pool.query(
        'SELECT id FROM forum_posts WHERE user_id = $1 AND demo_key = $2',
        [p.user, p.key]
      );
      postId = found.rows[0] && found.rows[0].id;
    }
    if (!postId) continue;
    for (const r of p.replies) {
      await pool.query(
        `INSERT INTO forum_replies (post_id, user_id, nickname, body, is_demo, created_at)
         SELECT $1,$2,$3,$4,true,$5
         WHERE NOT EXISTS (
           SELECT 1 FROM forum_replies
           WHERE post_id = $1 AND user_id = $2 AND is_demo AND body = $4
         )`,
        [postId, r.user, r.nick, r.body, DEMO_HOURS(r.hours)]
      );
    }
  }
}

// The viewer's own demo question, stored so Hapus works on it. Only with
// ?demo=1, and marked demo so no other route shows it.
async function ensureOwnDemoPost(userId) {
  const inserted = await pool.query(
    `INSERT INTO forum_posts (user_id, nickname, category, title, body, is_demo, demo_key, created_at)
     VALUES ($1,'Kamu',$2,$3,$4,true,'own',$5)
     ON CONFLICT (user_id, demo_key) DO NOTHING
     RETURNING id`,
    [userId, OWN_DEMO_POST.category, OWN_DEMO_POST.title, OWN_DEMO_POST.body, DEMO_HOURS(24)]
  );
  const postId = inserted.rows[0] && inserted.rows[0].id;
  if (!postId) return;
  const r = OWN_DEMO_POST.reply;
  await pool.query(
    `INSERT INTO forum_replies (post_id, user_id, nickname, body, is_demo, created_at)
     SELECT $1,$2,$3,$4,true,$5
     WHERE NOT EXISTS (SELECT 1 FROM forum_replies WHERE post_id = $1 AND user_id = $2)`,
    [postId, r.user, r.nick, r.body, DEMO_HOURS(r.hours)]
  );
}

app.get('/api/posts', async (req, res) => {
  const userId = req.user ? req.user.id : null;
  const demo = IS_STAGING && req.query.demo === '1' && !!userId;
  try {
    if (demo) await ensureOwnDemoPost(userId);
    const posts = await pool.query(
      `SELECT id, user_id, nickname, category, title, body, created_at,
              photo_url, photo_id, (user_id = $1) AS mine
       FROM forum_posts
       WHERE (NOT is_demo OR $2::boolean)
       ORDER BY created_at DESC, id DESC`,
      [userId, demo]
    );
    const ids = posts.rows.map((p) => p.id);
    let replies = [];
    if (ids.length) {
      replies = (
        await pool.query(
          `SELECT id, post_id, user_id, nickname, body, created_at,
                  photo_url, photo_id, (user_id = $1) AS mine
           FROM forum_replies
           WHERE post_id = ANY($2::int[])
           ORDER BY created_at ASC, id ASC`,
          [userId, ids]
        )
      ).rows;
    }
    res.json({
      posts: posts.rows.map((p) => ({
        id: p.id,
        nickname: p.nickname,
        category: p.category,
        title: p.title,
        body: p.body,
        created_at: iso(p.created_at),
        mine: p.mine === true,
        photo_url: p.photo_url || null,
        photo_id: p.photo_id || null,
        replies: replies
          .filter((r) => r.post_id === p.id)
          .map((r) => ({
            id: r.id,
            nickname: r.nickname,
            body: r.body,
            created_at: iso(r.created_at),
            mine: r.mine === true,
            photo_url: r.photo_url || null,
            photo_id: r.photo_id || null,
          })),
      })),
    });
  } catch (err) {
    console.error('GET /api/posts failed: ' + err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

app.post('/api/posts', async (req, res) => {
  const category = req.body && req.body.category;
  const title = textField(req.body && req.body.title, 120);
  const body = textField(req.body && req.body.body, 2000);
  const nickname = textField(req.body && req.body.nickname, 40);
  if (!CATEGORIES.has(category) || !title || !body || !nickname) {
    return res.status(400).json({ error: 'invalid_post' });
  }
  const photo = photoFields(req.body);
  if (photo === false) return res.status(400).json({ error: 'invalid_photo' });
  try {
    const result = await pool.query(
      `INSERT INTO forum_posts (user_id, nickname, category, title, body, is_demo, photo_url, photo_id)
       VALUES ($1,$2,$3,$4,$5,false,$6,$7)
       RETURNING id, created_at`,
      [req.user.id, nickname, category, title, body, photo ? photo.url : null, photo ? photo.id : null]
    );
    res.status(201).json({ id: result.rows[0].id, created_at: iso(result.rows[0].created_at) });
  } catch (err) {
    console.error('POST /api/posts failed: ' + err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

app.post('/api/posts/:id/replies', async (req, res) => {
  const id = Number(req.params.id);
  const body = textField(req.body && req.body.body, 2000);
  const nickname = textField(req.body && req.body.nickname, 40);
  if (!Number.isInteger(id) || id <= 0 || !body || !nickname) {
    return res.status(400).json({ error: 'invalid_reply' });
  }
  const photo = photoFields(req.body);
  if (photo === false) return res.status(400).json({ error: 'invalid_photo' });
  try {
    const exists = await pool.query('SELECT 1 FROM forum_posts WHERE id = $1', [id]);
    if (!exists.rowCount) return res.status(404).json({ error: 'not_found' });
    const result = await pool.query(
      `INSERT INTO forum_replies (post_id, user_id, nickname, body, is_demo, photo_url, photo_id)
       VALUES ($1,$2,$3,$4,false,$5,$6)
       RETURNING id`,
      [id, req.user.id, nickname, body, photo ? photo.url : null, photo ? photo.id : null]
    );
    res.status(201).json({ id: result.rows[0].id });
  } catch (err) {
    console.error('POST reply failed: ' + err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

// Removing a post removes its replies (ON DELETE CASCADE); removing a reply
// just removes it. Only the person who wrote it may remove it.
app.delete('/api/posts/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid_id' });
  try {
    const owned = await pool.query(
      'SELECT 1 FROM forum_posts WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (!owned.rowCount) return res.status(403).json({ error: 'forbidden' });
    await pool.query('DELETE FROM forum_posts WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE post failed: ' + err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

app.delete('/api/replies/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid_id' });
  try {
    const owned = await pool.query(
      'SELECT 1 FROM forum_replies WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (!owned.rowCount) return res.status(403).json({ error: 'forbidden' });
    await pool.query('DELETE FROM forum_replies WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE reply failed: ' + err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

// Reports are recorded for the moderators; nothing is hidden automatically.
app.post('/api/reports', async (req, res) => {
  const kind = req.body && req.body.kind;
  const targetId = Number(req.body && req.body.target_id);
  if ((kind !== 'post' && kind !== 'reply') || !Number.isInteger(targetId) || targetId <= 0) {
    return res.status(400).json({ error: 'invalid_report' });
  }
  try {
    await pool.query(
      'INSERT INTO forum_reports (user_id, kind, target_id) VALUES ($1,$2,$3)',
      [req.user.id, kind, targetId]
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error('POST /api/reports failed: ' + err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

// ── Ternakku routes ────────────────────────────────────────────────────────
// A guest may read, but has no animals of their own: an empty list is the
// honest answer, and the page shows its sign-in empty state.
app.get('/api/animals', async (req, res) => {
  if (!req.user) return res.json({ animals: [] });
  try {
    const { rows } = await pool.query(
      ANIMAL_SELECT + ' WHERE a.user_id = $1 ORDER BY a.created_at DESC, a.id DESC',
      [req.user.id]
    );
    res.json({ animals: rows.map(animalJson) });
  } catch (err) {
    console.error('GET /api/animals failed: ' + err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

app.post('/api/animals', async (req, res) => {
  const body = req.body || {};
  const name = textField(body.name, 60);
  const kind = body.kind;
  const ageMonths = intField(body.age_months, 0, 400);
  if (!name || !ANIMAL_KINDS.has(kind) || ageMonths === false) {
    return res.status(400).json({ error: 'invalid_animal' });
  }
  const photo = photoFields(body);
  if (photo === false) return res.status(400).json({ error: 'invalid_photo' });
  let weightKg = null;
  if (body.weight_kg !== undefined && body.weight_kg !== null && body.weight_kg !== '') {
    weightKg = Number(body.weight_kg);
    if (!Number.isFinite(weightKg) || weightKg <= 0.05 || weightKg > 2000) {
      return res.status(400).json({ error: 'invalid_weight' });
    }
    weightKg = Math.round(weightKg * 10) / 10;
  }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const inserted = await db.query(
      `INSERT INTO animals (user_id, name, kind, age_months, photo_url, photo_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [req.user.id, name, kind, ageMonths, photo ? photo.url : null, photo ? photo.id : null]
    );
    const id = inserted.rows[0].id;
    // A weight typed in at creation is a real weighing, so the growth chart
    // and the weighing reminder start from today.
    if (weightKg !== null) {
      await db.query(
        `INSERT INTO animal_weights (animal_id, user_id, weighed_on, weight_kg)
         VALUES ($1,$2,$3,$4)`,
        [id, req.user.id, todayJakarta(req.now), weightKg]
      );
    }
    await db.query('COMMIT');
    res.status(201).json({ id });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('POST /api/animals failed: ' + err.message);
    res.status(500).json({ error: 'server_error' });
  } finally {
    db.release();
  }
});

app.get('/api/animals/:id', async (req, res) => {
  if (!req.user) return res.status(404).json({ error: 'not_found' });
  const id = Number(req.params.id);
  try {
    const row = await ownedAnimal(id, req.user.id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    const [weights, notes] = await Promise.all([
      pool.query(
        `SELECT id, to_char(weighed_on, 'YYYY-MM-DD') AS weighed_on,
                chest_cm, body_length_cm, weight_kg
           FROM animal_weights
          WHERE animal_id = $1
          ORDER BY weighed_on ASC, id ASC`,
        [id]
      ),
      pool.query(
        `SELECT id, kind, to_char(note_date, 'YYYY-MM-DD') AS note_date, body, created_at
           FROM animal_notes
          WHERE animal_id = $1
          ORDER BY note_date DESC, id DESC`,
        [id]
      ),
    ]);
    res.json({
      animal: Object.assign(animalJson(row), {
        weights: weights.rows.map((w) => ({
          id: w.id,
          weighed_on: w.weighed_on,
          chest_cm: w.chest_cm === null ? null : Number(w.chest_cm),
          body_length_cm: w.body_length_cm === null ? null : Number(w.body_length_cm),
          weight_kg: Number(w.weight_kg),
        })),
        notes: notes.rows.map((n) => ({
          id: n.id,
          kind: n.kind,
          note_date: n.note_date,
          body: n.body,
          created_at: iso(n.created_at),
        })),
      }),
    });
  } catch (err) {
    console.error('GET /api/animals/:id failed: ' + err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

// The care dates are what the reminders in the page count from. A date in the
// future is refused: it would put a reminder in a schedule that has not
// happened yet.
app.patch('/api/animals/:id', async (req, res) => {
  const id = Number(req.params.id);
  try {
    const current = await ownedAnimal(id, req.user.id);
    if (!current) return res.status(404).json({ error: 'not_found' });
    const body = req.body || {};
    const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
    const name = has('name') ? textField(body.name, 60) : current.name;
    const kind = has('kind') ? body.kind : current.kind;
    const ageMonths = has('age_months') ? intField(body.age_months, 0, 400) : current.age_months;
    if (!name || !ANIMAL_KINDS.has(kind) || ageMonths === false) {
      return res.status(400).json({ error: 'invalid_animal' });
    }
    const dates = {};
    for (const key of ['last_vaccine_on', 'last_deworm_on', 'mated_on']) {
      if (!has(key)) {
        dates[key] = current[key];
        continue;
      }
      const parsed = dayField(body[key]);
      if (parsed === false) return res.status(400).json({ error: 'invalid_date' });
      dates[key] = parsed;
    }
    const today = todayJakarta(req.now);
    for (const key of Object.keys(dates)) {
      if (dates[key] && dates[key] > today) {
        return res.status(400).json({ error: 'invalid_date' });
      }
    }
    await pool.query(
      `UPDATE animals
          SET name = $3, kind = $4, age_months = $5,
              last_vaccine_on = $6, last_deworm_on = $7, mated_on = $8
        WHERE id = $1 AND user_id = $2`,
      [id, req.user.id, name, kind, ageMonths === null ? null : Number(ageMonths),
       dates.last_vaccine_on, dates.last_deworm_on, dates.mated_on]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /api/animals/:id failed: ' + err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

app.delete('/api/animals/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid_id' });
  try {
    const deleted = await pool.query(
      'DELETE FROM animals WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (!deleted.rowCount) return res.status(403).json({ error: 'forbidden' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/animals/:id failed: ' + err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

// A weight comes either from a scale (`weight_kg`) or from the same chest
// measurements the quick tool uses. The server computes the estimate so the
// chart cannot be fed a number the formula did not produce.
app.post('/api/animals/:id/weights', async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  try {
    const animal = await ownedAnimal(id, req.user.id);
    if (!animal) return res.status(404).json({ error: 'not_found' });
    let weighedOn = dayField(body.weighed_on);
    if (weighedOn === false) return res.status(400).json({ error: 'invalid_date' });
    const today = todayJakarta(req.now);
    if (!weighedOn) weighedOn = today;
    if (weighedOn > today) return res.status(400).json({ error: 'invalid_date' });

    let weightKg;
    let chest = null;
    let length = null;
    const direct = body.weight_kg === undefined || body.weight_kg === null || body.weight_kg === ''
      ? null : Number(body.weight_kg);
    if (direct !== null) {
      if (!Number.isFinite(direct) || direct <= 0.05 || direct > 2000) {
        return res.status(400).json({ error: 'invalid_weight' });
      }
      weightKg = direct;
    } else {
      if (animal.kind === 'ayam') return res.status(400).json({ error: 'invalid_weight' });
      chest = Number(body.chest_cm);
      if (!Number.isFinite(chest) || chest < 40 || chest > 250) {
        return res.status(400).json({ error: 'invalid_measurement' });
      }
      if (animal.kind !== 'sapi') {
        length = Number(body.body_length_cm);
        if (!Number.isFinite(length) || length < 20 || length > 200) {
          return res.status(400).json({ error: 'invalid_measurement' });
        }
      }
      weightKg = estimateWeight(animal.kind, chest, length);
    }
    weightKg = Math.round(weightKg * 10) / 10;
    const inserted = await pool.query(
      `INSERT INTO animal_weights
         (animal_id, user_id, weighed_on, chest_cm, body_length_cm, weight_kg)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [id, req.user.id, weighedOn, chest, length, weightKg]
    );
    res.status(201).json({ id: inserted.rows[0].id, weighed_on: weighedOn, weight_kg: weightKg });
  } catch (err) {
    console.error('POST /api/animals/:id/weights failed: ' + err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

app.post('/api/animals/:id/notes', async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  try {
    const animal = await ownedAnimal(id, req.user.id);
    if (!animal) return res.status(404).json({ error: 'not_found' });
    const kind = body.kind;
    const text = textField(body.body, 2000);
    if (!NOTE_KINDS.has(kind) || !text) {
      return res.status(400).json({ error: 'invalid_note' });
    }
    let noteDate = dayField(body.note_date);
    if (noteDate === false) return res.status(400).json({ error: 'invalid_date' });
    const today = todayJakarta(req.now);
    if (!noteDate) noteDate = today;
    if (noteDate > today) return res.status(400).json({ error: 'invalid_date' });
    const inserted = await pool.query(
      `INSERT INTO animal_notes (animal_id, user_id, kind, note_date, body)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [id, req.user.id, kind, noteDate, text]
    );
    res.status(201).json({ id: inserted.rows[0].id });
  } catch (err) {
    console.error('POST /api/animals/:id/notes failed: ' + err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

// ── Tanya AI ───────────────────────────────────────────────────────────────
// Claude through the platform's LLM proxy, billed to the signed-in person's
// own AI budget. Staging gets no proxy credentials: the route says so and
// the page shows its fallback.
const LLM_PROXY_URL = (process.env.USERNODE_LLM_PROXY_URL || '').replace(/\/+$/, '');
const LLM_PROXY_TOKEN = process.env.USERNODE_LLM_PROXY_TOKEN || '';

const AI_SYSTEM_PROMPT = [
  'Anda asisten untuk peternak kecil di Indonesia. Jawab dalam bahasa Indonesia yang sederhana,',
  'singkat (sekitar 120 kata), dan praktis. Sebutkan langkah yang bisa dilakukan hari ini.',
  '',
  'Aturan wajib:',
  '- Jujur soal ketidakpastian. Jika tidak yakin, katakan begitu dan sebutkan apa yang perlu dicek.',
  '- Untuk hewan yang sakit parah, kasus darurat (sulit bernapas, tidak bisa berdiri, kejang,',
  '  melahirkan bermasalah, kehilangan banyak darah) atau penyakit menular seperti PMK, flu burung',
  '  dan antraks: selalu sarankan segera menghubungi dokter hewan atau dinas peternakan setempat.',
  '  Jangan menyarankan penanganan sendiri sebagai gantinya.',
  '- Jangan pernah memberi dosis obat keras atau obat resep. Dosis hanya ditentukan dokter hewan.',
  '- Jangan membahas kekerasan, senjata, perjudian, seksualitas, narkoba, atau topik dewasa lain,',
  '  dan tolak topik di luar peternakan. Untuk topik seperti itu, tolak dengan sopan dan singkat',
  '  tanpa menjelaskannya, lalu tawarkan kembali membantu soal ternak.',
  '- Hindari diagnosis pasti; sebut kemungkinan dan langkah yang aman.',
  '- Jika pengguna menyertakan data ternaknya (jenis, umur, berat, pengingat atau catatan),',
  '  pakai data itu dalam jawaban dan jangan mengulanginya berlebihan.',
  '- Peternak bisa mengirim foto ternak. Jelaskan hanya apa yang terlihat dan berkaitan dengan',
  '  ternak, kandang atau pakan, dan katakan bahwa foto tidak cukup untuk diagnosis pasti.',
  '- Jika foto tidak berisi ternak, kandang atau pakan, atau berisi hal yang dilarang di atas,',
  '  jangan jelaskan isinya: tolak dengan sopan dan minta foto ternak.',
  '- Ingatkan, bila perlu, bahwa ini informasi umum dan bukan pengganti dokter hewan.',
].join('\n');

const AI_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

// The newest photo in a chat, as the base64 image block the proxy takes. Only
// the newest one is sent, to keep each question cheap on the daily AI budget.
async function fetchAiPhoto(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!AI_IMAGE_TYPES.has(type)) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > 5 * 1024 * 1024) return null;
    return { mediaType: type, data: buf.toString('base64') };
  } catch {
    return null;
  }
}

const PHOTO_SENT_NOTE = ' (Peternak mengirim foto di pesan ini.)';
const PHOTO_FAILED_NOTE = ' (Foto tidak bisa dibuka.)';

function aiMessages(messages, imageIndex, image, photoFailed) {
  return messages.map((m, i) => {
    if (i === imageIndex && image) {
      return {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
          { type: 'text', text: m.content },
        ],
      };
    }
    if (m.photo_url) {
      const note = i === imageIndex && photoFailed ? PHOTO_FAILED_NOTE : PHOTO_SENT_NOTE;
      return { role: m.role, content: m.content + note };
    }
    return { role: m.role, content: m.content };
  });
}

async function callAiProxy(userToken, messages) {
  const upstream = await fetch(LLM_PROXY_URL + '/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-usernode-app-token': LLM_PROXY_TOKEN,
      'x-usernode-user-token': userToken || '',
    },
    body: JSON.stringify({
      model: 'claude-haiku-5-5',
      max_tokens: 600,
      system: AI_SYSTEM_PROMPT,
      messages,
    }),
  });
  const data = await upstream.json().catch(() => ({}));
  return { upstream, data };
}

app.post('/api/ai', async (req, res) => {
  const incoming = req.body && req.body.messages;
  if (!Array.isArray(incoming)) return res.status(400).json({ error: 'messages_required' });
  const messages = incoming
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-10)
    .map((m) => ({
      role: m.role,
      content: m.content.slice(0, 4000),
      // A photo on an assistant message is not a thing; drop anything whose
      // URL is not one of the platform's own files.
      photo_url: m.role === 'user' && appFileId(m.photo_url) ? m.photo_url : null,
    }))
    .filter((m) => m.content.trim().length > 0);
  if (!messages.length) return res.status(400).json({ error: 'messages_required' });
  if (!LLM_PROXY_URL || !LLM_PROXY_TOKEN) return res.status(503).json({ code: 'unavailable' });

  try {
    let imageIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user' && messages[i].photo_url) {
        imageIndex = i;
        break;
      }
    }
    const image = imageIndex >= 0 ? await fetchAiPhoto(messages[imageIndex].photo_url) : null;
    const userToken = req.headers['x-usernode-token'];
    let { upstream, data } = await callAiProxy(
      userToken,
      aiMessages(messages, imageIndex, image, imageIndex >= 0 && !image)
    );
    let photoSeen = !!(image && upstream.ok);
    // The proxy could not take an image (or the image itself failed to load):
    // ask once more with the text only and say the photo was not opened.
    if (!upstream.ok && image && !(data && data.code)) {
      photoSeen = false;
      ({ upstream, data } = await callAiProxy(userToken, aiMessages(messages, imageIndex, null, true)));
    }
    if (!upstream.ok) {
      if (data && data.code) return res.status(upstream.status).json({ code: data.code });
      console.warn('AI proxy answered ' + upstream.status);
      return res.status(502).json({ code: 'upstream_error' });
    }
    const text = (Array.isArray(data.content) ? data.content : [])
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (!text) return res.status(502).json({ code: 'empty_answer' });
    res.json({ text, photo_seen: photoSeen });
  } catch (err) {
    console.warn('AI call failed: ' + err.message);
    res.status(502).json({ code: 'upstream_error' });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// HTML shell: serve the app if authenticated. Unauthenticated top-level
// visits (share links pasted into a browser — Sec-Fetch-Dest: document)
// are sent to the platform's chromeless view of this app, where the shell
// embeds it with a real token so the link just works. Every other
// tokenless case (iframe loads with an expired token, old browsers
// without Sec-Fetch-*) gets the "open in Homeroom" landing page instead
// of a redirect, so the platform shell is never loaded INSIDE its own
// app iframe and stray visits still don't reveal the app.
app.get('*', (req, res) => {
  if (!req.user && !req.guest) {
    // Deep-link pass-through (platform #743): carry the visited
    // path+query into the chromeless view so share links land on the
    // shared screen, not Home. The clean platform route stores `path`
    // as one encoded query value so an inner ?, &, or = survives. The
    // shell decodes and validates it as relative-only before use. The
    // character test keeps the
    // value attribute-safe for the landing anchor below — anything
    // unusual falls back to the bare link.
    const deepPath = /^\/[A-Za-z0-9\-._~!$&()*+,;=:@\/%?]*$/.test(req.originalUrl)
      ? '?path=' + encodeURIComponent(req.originalUrl) : '';
    const appPath = APP_SLUG ? '/app/' + encodeURIComponent(APP_SLUG) + '/full' + deepPath : '';
    if (PLATFORM_ORIGIN && req.get('sec-fetch-dest') === 'document') {
      return res.redirect(302, PLATFORM_ORIGIN + appPath);
    }
    return res.status(401).send(`<!doctype html><meta charset=utf-8><title>Open in Homeroom</title>
<body style="font-family:system-ui;background:#09090b;color:#e4e4e7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <div style="max-width:24rem;padding:2rem;text-align:center">
    <h1 style="font-size:1.25rem;margin:0 0 0.5rem">Open this app inside Homeroom</h1>
    <p style="color:#a1a1aa;font-size:0.9rem;margin:0 0 1.25rem">This page is served via the platform; direct visits aren't authenticated.</p>
    <a href="${PLATFORM_ORIGIN}${appPath}" style="display:inline-block;padding:0.5rem 1rem;background:#7c3aed;color:white;border-radius:0.5rem;text-decoration:none;font-size:0.9rem">Open in Homeroom</a>
  </div>
</body>`);
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

let server = null;

async function start() {
  await ensureSchema();
  if (IS_STAGING) {
    try {
      await seedDemoForum();
    } catch (err) {
      console.warn('staging demo seed failed: ' + err.message);
    }
  }
  server = app.listen(port, () => console.log(`Listening on :${port}`));
  // Let Envoy retire idle upstream connections at 60s, with a 15s margin.
  server.keepAliveTimeout = 75_000;
}

// Stop accepting connections, give in-flight requests about 3 seconds, then
// close the pool and exit.
function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  const done = () => pool.end().finally(() => process.exit(0));
  if (!server) return done();
  server.close(done);
  setTimeout(done, 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start().catch(err => { console.error(err); process.exit(1); });
