// Twenty webhook -> Slack #myynti relay.
// Verifies Twenty's HMAC signature, resolves related record names via the REST API,
// then posts a Dealbot-style Slack attachment (blue title + left border, bold labels).

import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';

const PORT = Number(process.env.RELAY_PORT || 8787);
const SECRET = process.env.TWENTY_WEBHOOK_SECRET || '';
const SLACK_URL = process.env.SLACK_WEBHOOK_URL || '';
const BASE_URL = process.env.TWENTY_BASE_URL || 'https://crm.dude.fi';
const TOKEN = process.env.TWENTY_API_TOKEN || '';

const CONFIG_URL = new URL('./config.mjs', import.meta.url);
const log = (...a) => console.log(new Date().toISOString(), ...a);

const httpsRequest = (urlString, options, body) =>
  new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: options.method || 'GET',
        headers: options.headers || {},
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });

const postSlack = async (attachment) => {
  const payload = { attachments: [{ mrkdwn_in: ['text', 'pretext'], ...attachment }] };
  if (!SLACK_URL) {
    log('SLACK_WEBHOOK_URL not set, would post:', JSON.stringify(payload));
    return;
  }
  const body = JSON.stringify(payload);
  try {
    await httpsRequest(SLACK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, body);
  } catch (e) {
    log('slack post error', e.message);
  }
};

// --- related-record name resolution (for "show things directly") ---
const PLURAL = { opportunity: 'opportunities', person: 'people', company: 'companies' };
const cache = new Map();
const CACHE_MS = 5 * 60 * 1000;

const nameOf = (rec) => {
  const n = rec?.name;
  if (typeof n === 'string') return n;
  if (n && (n.firstName || n.lastName))
    return [n.firstName, n.lastName].filter(Boolean).join(' ').trim();
  return rec?.id ? rec.id.slice(0, 8) : '';
};

const resolveRecord = async (object, id) => {
  if (!id || !TOKEN) return undefined;
  const key = `${object}:${id}`;
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.val;
  const plural = PLURAL[object];
  if (!plural) return undefined;
  try {
    const res = await httpsRequest(`${BASE_URL}/rest/${plural}/${id}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const parsed = JSON.parse(res.body || '{}');
    const inner = parsed?.data?.[object] ?? parsed?.[object] ?? parsed;
    const val = { name: nameOf(inner) || '(nimetön)', link: `${BASE_URL}/object/${object}/${id}` };
    cache.set(key, { val, exp: Date.now() + CACHE_MS });
    return val;
  } catch (e) {
    log('resolve error', object, id, e.message);
    return undefined;
  }
};

const verify = (ts, sig, raw) => {
  if (!SECRET) return true;
  if (!ts || !sig) return false;
  const expected = crypto.createHmac('sha256', SECRET).update(`${ts}:${raw}`).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
};

const recordNameString = (record) => {
  if (typeof record.name === 'string') return record.name;
  if (record.name?.firstName || record.name?.lastName)
    return [record.name.firstName, record.name.lastName].filter(Boolean).join(' ');
  return [record.nameFirstName, record.nameLastName].filter(Boolean).join(' ');
};

const handleEvent = async (data) => {
  const { rules, ignore = [] } = await import(`${CONFIG_URL}?t=${Date.now()}`);
  const eventName = data.eventName;
  const nameSingular = data.objectMetadata?.nameSingular;
  const record = data.record || {};
  const updatedFields = data.updatedFields || [];

  const rule = rules.find(
    (r) =>
      r.enabled &&
      r.event === eventName &&
      (!r.when || r.when(record, updatedFields)),
  );
  if (!rule) return;

  const [company, person, opportunity, pointOfContact] = await Promise.all([
    resolveRecord('company', record.companyId),
    resolveRecord('person', record.personId),
    resolveRecord('opportunity', record.opportunityId),
    resolveRecord('person', record.pointOfContactId),
  ]);

  const ctx = {
    baseUrl: BASE_URL,
    link: `${BASE_URL}/object/${nameSingular}/${record.id}`,
    updatedFields,
    actor:
      record.updatedBy?.name ||
      record.createdBy?.name ||
      record.createdByName ||
      '',
    company,
    person,
    opportunity,
    pointOfContact,
  };

  const haystack = [
    recordNameString(record),
    record.title,
    record.bodyMarkdown,
    record.body?.markdown,
    ctx.person?.name,
    ctx.pointOfContact?.name,
    ctx.opportunity?.name,
    ctx.company?.name,
  ]
    .filter(Boolean)
    .join(' | ');

  if (ignore.some((re) => re.test(haystack))) {
    log('skipped (ignore match)', eventName, record.id);
    return;
  }

  const attachment = rule.format(record, ctx);
  if (attachment) {
    await postSlack(attachment);
    log('posted', eventName, record.id);
  }
};

const server = http.createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405);
    return res.end('method not allowed');
  }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!verify(req.headers['x-twenty-webhook-timestamp'], req.headers['x-twenty-webhook-signature'], raw)) {
      log('bad signature');
      res.writeHead(401);
      return res.end('bad signature');
    }
    res.writeHead(200);
    res.end('ok');
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    handleEvent(data).catch((e) => log('relay error', e.message));
  });
});

server.listen(PORT, '127.0.0.1', () => log(`twenty-slack-relay listening on 127.0.0.1:${PORT}`));
