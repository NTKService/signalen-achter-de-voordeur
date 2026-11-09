// Signalen achter de voordeur – testprototype voor een afstudeeronderzoek.
// Geen officieel meldsysteem. Testinzendingen worden tijdelijk bewaard zodat de onderzoeker kan zien hoe het formulier werkt.
//
// Instellingen (Railway → Variables):
//   ADMIN_WACHTWOORD      verplicht om de beheeromgeving te kunnen gebruiken
//   BEWAARTERMIJN_DAGEN   optioneel, standaard 30: oudere testinzendingen worden automatisch verwijderd
// Opslag: in een Railway-volume (RAILWAY_VOLUME_MOUNT_PATH of DATA_DIR), anders in ./data (verdwijnt bij een nieuwe deploy).
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const WACHTWOORD = process.env.ADMIN_WACHTWOORD || '';
const BEWAARDAGEN = Math.max(1, parseInt(process.env.BEWAARTERMIJN_DAGEN || '30', 10) || 30);
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'inzendingen.json');
const MAX_BODY = 20000;

// ---------- formulierpagina ----------
const pageFile = [path.join(__dirname, 'index.html'), path.join(__dirname, 'public', 'index.html')].find(f => fs.existsSync(f));
const page = pageFile ? fs.readFileSync(pageFile) : Buffer.from('<h1>index.html ontbreekt</h1>');

// ---------- opslag (JSON-bestand, atomisch weggeschreven) ----------
fs.mkdirSync(DATA_DIR, { recursive: true });
let db = { inzendingen: [], bezoeken: [] };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); } catch (e) { /* nog geen bestand */ }
function bewaar() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}
function ruimOp() {
  const grens = Date.now() - BEWAARDAGEN * 24 * 60 * 60 * 1000;
  const voor = db.inzendingen.length + db.bezoeken.length;
  db.inzendingen = db.inzendingen.filter(x => x.ontvangen >= grens);
  db.bezoeken = db.bezoeken.filter(x => x.t >= grens).slice(-5000);
  if (db.inzendingen.length + db.bezoeken.length !== voor) bewaar();
}
ruimOp();
setInterval(ruimOp, 60 * 60 * 1000).unref();

// ---------- hulpfuncties ----------
const tijd = ms => new Date(ms).toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam', dateStyle: 'medium', timeStyle: 'short' });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function apparaat(ua = '') {
  if (/bot|crawl|spider|preview|monitor|health/i.test(ua)) return null;
  if (/iPhone/i.test(ua)) return 'telefoon (iPhone)';
  if (/Android/i.test(ua) && /Mobile/i.test(ua)) return 'telefoon (Android)';
  if (/iPad|Android/i.test(ua)) return 'tablet';
  if (/Windows/i.test(ua)) return 'computer (Windows)';
  if (/Macintosh/i.test(ua)) return 'computer (Mac)';
  return 'onbekend apparaat';
}
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim()).filter(Boolean).map(c => [c.slice(0, c.indexOf('=')), c.slice(c.indexOf('=') + 1)]));
function leesBody(req, cb) {
  let data = '', te = false;
  req.on('data', c => { data += c; if (data.length > MAX_BODY) { te = true; req.destroy(); } });
  req.on('end', () => { if (!te) cb(data); });
}
const veiligGelijk = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
function stuur(res, status, body, extra = {}) { res.writeHead(status, Object.assign({}, HEADERS, extra)); res.end(body); }
function redirect(res, waar, extra = {}) { stuur(res, 303, '', Object.assign({ Location: waar }, extra)); }

// Opschonen van een inzending: alleen bekende velden, beperkte lengte
const VELDEN = ['taal', 'ikMeldAls', 'adres', 'plaats', 'datum', 'zorg', 'anders', 'directGevaar', 'hoeVol', 'gezien', 'eerderGeweest', 'veranderingen', 'burenLast', 'beschrijving', 'opmerkingen', 'naam', 'bedrijf', 'contact', 'anoniem'];
function schoon(d) {
  const o = {};
  for (const k of VELDEN) {
    let v = d[k];
    if (Array.isArray(v)) v = v.slice(0, 20).map(x => String(x).slice(0, 300));
    else if (typeof v === 'boolean' || v === null || v === undefined) v = v ?? null;
    else v = String(v).slice(0, 2000);
    o[k] = v;
  }
  return o;
}

// Eenvoudige limiet tegen spam (in geheugen, zonder IP-adressen op te slaan)
let recent = [];
function teVeel() { const nu = Date.now(); recent = recent.filter(t => nu - t < 10 * 60 * 1000); if (recent.length >= 60) return true; recent.push(nu); return false; }

// ---------- sessies beheer ----------
const sessies = new Map(); // token -> { csrf, verloopt }
let fouteLogins = [];
function sessie(req) {
  const tok = cookies(req).beheer;
  const s = tok && sessies.get(tok);
  if (!s || s.verloopt < Date.now()) { if (tok) sessies.delete(tok); return null; }
  s.verloopt = Date.now() + 2 * 60 * 60 * 1000;
  return s;
}

// ---------- beheerpagina's ----------
const STIJL = `<style>body{font-family:Arial,Helvetica,sans-serif;margin:0;background:#f2f2f4;color:#1d1d1f}
header{background:#fff;border-bottom:3px solid #d6001c;padding:14px 16px;display:flex;justify-content:space-between;align-items:center}
header b{color:#d6001c}main{max-width:900px;margin:0 auto;padding:16px}.card{background:#fff;border-radius:12px;padding:16px;margin-bottom:14px}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #e3e3e8;padding:8px 6px;text-align:left;font-size:14px;vertical-align:top}
a{color:#d6001c}button{font-family:inherit;border-radius:8px;padding:8px 12px;font-size:14px;cursor:pointer}
.del{background:#fff;border:1.5px solid #d6001c;color:#d6001c}.prim{background:#d6001c;color:#fff;border:0}
.n{color:#6b6b70;font-size:13px}dl{display:grid;grid-template-columns:200px 1fr;gap:6px 12px;margin:0}dt{color:#6b6b70}dd{margin:0;white-space:pre-wrap}
input[type=password]{width:100%;padding:11px;border:1px solid #d9d9de;border-radius:8px;font-size:16px;margin:8px 0 12px}form{display:inline}</style>`;
const kop = (titel, ingelogd, csrf) => `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(titel)}</title>${STIJL}</head><body>
<header><div><b>Beheer</b> · Signalen achter de voordeur (testprototype)</div>${ingelogd ? `<form method="post" action="/beheer/uitloggen"><input type="hidden" name="csrf" value="${csrf}"><button class="del">Uitloggen</button></form>` : ''}</header><main>`;
const voet = '</main></body></html>';

function loginPagina(fout) {
  return kop('Inloggen', false) + `<div class="card"><h2>Inloggen</h2>${!WACHTWOORD ? '<p>De beheeromgeving staat uit. Stel bij Railway de variabele <b>ADMIN_WACHTWOORD</b> in.</p>' :
    `${fout ? `<p style="color:#d6001c">${esc(fout)}</p>` : ''}<form method="post" action="/beheer/login" style="display:block"><label>Wachtwoord<input type="password" name="wachtwoord" autofocus autocomplete="current-password"></label><button class="prim">Inloggen</button></form>`}</div>` + voet;
}

const LABELS = { taal: 'Taal', ikMeldAls: 'Ik meld als', adres: 'Adres en huisnummer', plaats: 'Plaats', datum: 'Datum bezoek', zorg: 'Wat is je zorg?', anders: 'Anders, namelijk', directGevaar: 'Direct gevaar?', hoeVol: 'Hoe vol is de woning?', gezien: 'Wat zag je?', eerderGeweest: 'Eerder in de woning geweest?', veranderingen: 'Veranderingen over tijd?', burenLast: 'Hebben buren er last van?', beschrijving: 'Korte beschrijving', opmerkingen: 'Opmerkingen', naam: 'Naam', bedrijf: 'Bedrijf of afdeling', contact: 'Telefoon of e-mail', anoniem: 'Anoniem houden' };
const WAARDEN = { vol: 'Volle woning', vies: 'Vieze woning', anders: 'Anders', vakman: 'Vakman', werkorganisator: 'Werkorganisator ketenpartner', ja: 'Ja', nee: 'Nee', wn: 'Weet niet', erger: 'Ja, erger', '1-2': 'Foto 1 t/m 2', '3-6': 'Foto 3 t/m 6', '7-9': 'Foto 7 t/m 9', onbekend: 'Kon het niet goed zien', true: 'Ja', false: 'Nee', nl: 'Nederlands', en: 'Engels', tr: 'Turks', pl: 'Pools' };
const toon = v => v === null || v === '' || (Array.isArray(v) && !v.length) ? '–' : Array.isArray(v) ? v.map(x => WAARDEN[x] || x).join('\n') : (WAARDEN[String(v)] || String(v));

function overzicht(s) {
  const rijen = db.inzendingen.slice().reverse().map(x => `<tr><td>${esc(tijd(x.ontvangen))}</td><td>${esc(x.apparaat)}</td><td>${esc(toon(x.antwoorden.zorg))}</td><td>${esc(x.antwoorden.plaats || '–')}</td>
<td><a href="/beheer/inzending/${esc(x.id)}">Openen</a></td><td><form method="post" action="/beheer/verwijder/${esc(x.id)}" onsubmit="return confirm('Deze testinzending verwijderen?')"><input type="hidden" name="csrf" value="${s.csrf}"><button class="del">Verwijderen</button></form></td></tr>`).join('');
  const bez = db.bezoeken.slice(-50).reverse().map(b => `<tr><td>${esc(tijd(b.t))}</td><td>${esc(b.a)}</td></tr>`).join('');
  return kop('Beheer', true, s.csrf) + `<div class="card"><h2>Testinzendingen (${db.inzendingen.length})</h2>
<p class="n">Testinzendingen worden na ${BEWAARDAGEN} dagen automatisch verwijderd.</p>
${rijen ? `<table><tr><th>Ontvangen</th><th>Apparaat</th><th>Zorg</th><th>Plaats</th><th></th><th></th></tr>${rijen}</table>
<p style="margin-top:14px"><form method="post" action="/beheer/verwijder-alles" onsubmit="return confirm('Alle testinzendingen verwijderen?')"><input type="hidden" name="csrf" value="${s.csrf}"><button class="del">Alle testinzendingen verwijderen</button></form></p>` : '<p>Nog geen testinzendingen.</p>'}</div>
<div class="card"><h2>Pagina geopend (${db.bezoeken.length})</h2><p class="n">Alleen datum, tijd en soort apparaat. Laatste 50 hieronder.</p>
${bez ? `<table><tr><th>Tijd</th><th>Apparaat</th></tr>${bez}</table>` : '<p>Nog geen bezoeken.</p>'}</div>` + voet;
}

function detail(s, x) {
  const velden = VELDEN.map(k => `<dt>${esc(LABELS[k])}</dt><dd>${esc(toon(x.antwoorden[k]))}</dd>`).join('');
  return kop('Testinzending', true, s.csrf) + `<p><a href="/beheer">← Terug naar overzicht</a></p><div class="card"><h2>Testinzending</h2>
<p class="n">Ontvangen op ${esc(tijd(x.ontvangen))} · ${esc(x.apparaat)}</p><dl>${velden}</dl>
<p style="margin-top:16px"><form method="post" action="/beheer/verwijder/${esc(x.id)}" onsubmit="return confirm('Deze testinzending verwijderen?')"><input type="hidden" name="csrf" value="${s.csrf}"><button class="del">Verwijderen</button></form></p></div>` + voet;
}

// ---------- server ----------
http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const ua = req.headers['user-agent'];

  // Formulier
  if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
    const a = apparaat(ua);
    if (a && !sessie(req)) { db.bezoeken.push({ t: Date.now(), a }); bewaar(); console.log(`[BEZOEK] ${tijd(Date.now())} – ${a}`); }
    return stuur(res, 200, page, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  }

  // Testinzending ontvangen
  if (url === '/api/inzending' && req.method === 'POST') {
    if (!/application\/json/.test(req.headers['content-type'] || '')) return stuur(res, 415, '');
    if (teVeel()) return stuur(res, 429, '');
    return leesBody(req, data => {
      try {
        const x = { id: crypto.randomBytes(8).toString('hex'), ontvangen: Date.now(), apparaat: apparaat(ua) || 'onbekend', antwoorden: schoon(JSON.parse(data)) };
        db.inzendingen.push(x); if (db.inzendingen.length > 1000) db.inzendingen.shift(); bewaar();
        console.log(`[TESTINZENDING] ${tijd(x.ontvangen)} – ${x.apparaat} – id ${x.id}`);
        stuur(res, 201, JSON.stringify({ ok: true }), { 'Content-Type': 'application/json' });
      } catch (e) { stuur(res, 400, ''); }
    });
  }

  // Beheer
  if (url === '/beheer/login' && req.method === 'POST') {
    return leesBody(req, data => {
      const nu = Date.now(); fouteLogins = fouteLogins.filter(t => nu - t < 15 * 60 * 1000);
      if (fouteLogins.length >= 10) return stuur(res, 429, loginPagina('Te veel pogingen. Probeer het over een kwartier opnieuw.'), { 'Content-Type': 'text/html; charset=utf-8' });
      const ww = new URLSearchParams(data).get('wachtwoord') || '';
      if (!WACHTWOORD || !veiligGelijk(ww, WACHTWOORD)) { fouteLogins.push(nu); return stuur(res, 401, loginPagina('Onjuist wachtwoord.'), { 'Content-Type': 'text/html; charset=utf-8' }); }
      const tok = crypto.randomBytes(32).toString('hex');
      sessies.set(tok, { csrf: crypto.randomBytes(16).toString('hex'), verloopt: nu + 2 * 60 * 60 * 1000 });
      const secure = (req.headers['x-forwarded-proto'] || '') === 'https' ? '; Secure' : '';
      redirect(res, '/beheer', { 'Set-Cookie': `beheer=${tok}; Path=/; HttpOnly; SameSite=Strict; Max-Age=7200${secure}` });
    });
  }
  if (url.startsWith('/beheer')) {
    const s = sessie(req);
    const html = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' };
    if (!s) return url === '/beheer' && req.method === 'GET' ? stuur(res, 200, loginPagina(), html) : redirect(res, '/beheer');
    if (req.method === 'GET' && url === '/beheer') return stuur(res, 200, overzicht(s), html);
    const m = url.match(/^\/beheer\/inzending\/([0-9a-f]{16})$/);
    if (req.method === 'GET' && m) { const x = db.inzendingen.find(i => i.id === m[1]); return x ? stuur(res, 200, detail(s, x), html) : redirect(res, '/beheer'); }
    if (req.method === 'POST') {
      return leesBody(req, data => {
        if (!veiligGelijk(new URLSearchParams(data).get('csrf') || '', s.csrf)) return stuur(res, 403, 'Ongeldig verzoek.');
        const d = url.match(/^\/beheer\/verwijder\/([0-9a-f]{16})$/);
        if (d) { db.inzendingen = db.inzendingen.filter(i => i.id !== d[1]); bewaar(); console.log(`[VERWIJDERD] id ${d[1]}`); return redirect(res, '/beheer'); }
        if (url === '/beheer/verwijder-alles') { db.inzendingen = []; bewaar(); console.log('[VERWIJDERD] alle testinzendingen'); return redirect(res, '/beheer'); }
        if (url === '/beheer/uitloggen') { sessies.delete(cookies(req).beheer); return redirect(res, '/beheer', { 'Set-Cookie': 'beheer=; Path=/; Max-Age=0' }); }
        stuur(res, 404, '');
      });
    }
    return stuur(res, 404, '');
  }

  stuur(res, 404, '');
}).listen(PORT, '0.0.0.0', () => console.log(`Prototype draait op poort ${PORT} · opslag: ${DATA_DIR} · bewaartermijn: ${BEWAARDAGEN} dagen${WACHTWOORD ? '' : ' · beheer uit (geen ADMIN_WACHTWOORD)'}`));
