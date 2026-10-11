/**
 * Elephant Metrics receiver - Google Apps Script web app (runs in STE's Google
 * Workspace; no server needed). The calculator's "Send to Save the Elephants"
 * button posts the metrics file here; it is checked, saved to a Drive folder and
 * e-mailed to NOTIFY_EMAIL. The update check is NOT done here any more: the
 * calculator reads version.json from the GitHub Pages site itself. This script only
 * reads that same public file to flag submissions from outdated calculators.
 * Setup: see README.md in this folder.
 */
const FOLDER_ID = 'PASTE_DRIVE_FOLDER_ID_HERE';        // Drive folder that collects submissions (private)
const VERSION_URL = 'https://ctisavetheelephants.github.io/Elephant_movement_metric_toolkit/version.json'; // public release note
const NOTIFY_EMAIL = 'angela@savetheelephants.org';      // who is told about each submission
const MAX_CHARS = 20 * 1024 * 1024;                      // reject anything larger than ~20 MB

const REQUIRED = ['Dataset', 'Study_Area', 'Name', 'Sex', 'year', 'month', 'metric', 'value', 'granularity', 'tool_version'];
const FORBIDDEN = /^(lat|lon|long|latitude|longitude|lat_wgs|lon_wgs|x|y|easting|northing|geometry|timestamp|timestamp_corrected|fixtime|datetime)$/i;

function doPost(e) {
  try {
    const p = (e && e.parameter) || {};
    const csv = String(p.metrics || '');
    if (!csv) return page_('Nothing received', 'The metrics file was empty. Please try again from the calculator.');
    if (csv.length > MAX_CHARS) return page_('File too large', 'Please e-mail the metrics file to ' + NOTIFY_EMAIL + ' instead.');
    const header = csv.slice(0, csv.indexOf('\n')).replace(/\r$/, '').split(',').map(function (s) { return s.replace(/^"|"$/g, '').trim(); });
    const missing = REQUIRED.filter(function (c) { return header.indexOf(c) < 0; });
    if (missing.length) return page_('Not a metrics file', 'Only the *_metrics.csv file made by the Elephant Movement Metrics Calculator can be sent.');
    if (header.some(function (c) { return FORBIDDEN.test(c); })) return page_('Raw data refused', 'This file appears to contain locations or fix times, which are never collected. Nothing was saved.');

    const rows = csv.split('\n').filter(String).length - 1;
    const sa = clean_(p.study_area) || 'study_area';
    const org = clean_(p.organisation) || 'organisation';
    const stamp = Utilities.formatDate(new Date(), 'UTC', "yyyy-MM-dd'T'HHmm'Z'");
    const base = sa + '_' + org + '_' + stamp;
    const folder = DriveApp.getFolderById(FOLDER_ID);
    const files = [folder.createFile(base + '_metrics.csv', csv, MimeType.CSV)];
    if (p.report) files.push(folder.createFile(base + '_report.txt', String(p.report).slice(0, 200000), MimeType.PLAIN_TEXT));

    const contact = String(p.contact_email || '').trim();
    const ver = versionStatus_(p.tool_version);
    const mail = {
      to: NOTIFY_EMAIL,
      subject: (ver.flag ? '[' + ver.flag + '] ' : '') +
               'Elephant metrics received: ' + (p.study_area || '?') + ' (' + (p.organisation || 'no organisation given') + ')',
      body: [
        'New metrics submission from the Elephant Movement Metrics Calculator.', '',
        'Study area(s): ' + (p.study_area || '-'),
        'Organisation:  ' + (p.organisation || '-'),
        'Contact:       ' + (p.contact_name || '-') + ' <' + (contact || '-') + '>',
        'Calculator:    v' + (p.tool_version || '?') + (ver.text ? '  (' + ver.text + ')' : ''),
        'Rows:          ' + rows, '',
        'Message:', String(p.message || '-').slice(0, 5000), '',
        'Saved to Drive: ' + folder.getUrl(),
      ].join('\n'),
      attachments: files.map(function (f) { return f.getBlob(); }),
    };
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact)) mail.replyTo = contact;
    MailApp.sendEmail(mail);
    return page_('Thank you!', 'Your metrics for ' + (p.study_area || 'your study area') + ' (' + rows +
                 ' values) were received by Save the Elephants. You can close this tab.');
  } catch (err) {
    return page_('Something went wrong', 'Your file could not be saved (' + err + '). Please e-mail it to ' + NOTIFY_EMAIL + '.');
  }
}

function doGet(e) {
  // Calculator 1.0.0 (handed out through Google Drive) asked the receiver for updates
  // (?check=version). Answering it from the GitHub version note lets those copies show
  // the update banner with the new GitHub Pages link. Remove once nobody uses 1.0.0.
  if (e && e.parameter && e.parameter.check === 'version') {
    return ContentService.createTextOutput(JSON.stringify(versionNote_() || {}))
                         .setMimeType(ContentService.MimeType.JSON);
  }
  return page_('Elephant Metrics receiver', 'This address receives metric files from the Elephant Movement Metrics Calculator.');
}

// ---- version note -------------------------------------------------------------
// version.json is written by release.js and published with the calculator on GitHub
// Pages (VERSION_URL). Only these fields are used. Cached for 10 minutes.
function versionNote_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('version_note');
  if (hit) return JSON.parse(hit);
  try {
    const r = UrlFetchApp.fetch(VERSION_URL, { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) return null;
    const v = JSON.parse(r.getContentText());
    const note = { latest: String(v.latest || ''), min_version: String(v.min_version || ''), released: String(v.released || ''),
                   notes: String(v.notes || '').slice(0, 1000), download: String(v.download || '') };
    cache.put('version_note', JSON.stringify(note), 600);
    return note;
  } catch (err) {
    return null;
  }
}
// -1 / 0 / 1 comparing "1.2.3" strings
function cmpVer_(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0) ? -1 : 1;
  return 0;
}
// Flags results made with an outdated calculator (shown in the e-mail; nothing is refused)
function versionStatus_(v) {
  const note = versionNote_();
  if (!v || !/^\d+\.\d+\.\d+$/.test(String(v))) return { flag: 'UNKNOWN CALCULATOR VERSION', text: 'version not recognised' };
  if (!note || !note.latest) return { flag: '', text: '' };
  if (note.min_version && cmpVer_(v, note.min_version) < 0)
    return { flag: 'OUTDATED CALCULATOR v' + v, text: 'below the required minimum ' + note.min_version + '; latest is ' + note.latest };
  if (cmpVer_(v, note.latest) < 0) return { flag: 'OLDER CALCULATOR v' + v, text: 'latest is ' + note.latest };
  return { flag: '', text: 'up to date' };
}

function clean_(s) { return String(s || '').replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '_').slice(0, 60); }
function esc_(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function page_(title, msg) {
  return HtmlService.createHtmlOutput(
    '<div style="font-family:system-ui,sans-serif;max-width:560px;margin:60px auto;padding:0 16px;color:#1f2a24">' +
    '<h2 style="color:#2f6b4f">' + esc_(title) + '</h2><p style="font-size:16px;line-height:1.5">' + esc_(msg) + '</p></div>'
  ).setTitle(title);
}
