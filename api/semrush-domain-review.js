const express = require('express');
const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');

const router = express.Router();

const REVIEW_TIMEOUT_MS = Number(process.env.SEMRUSH_DOMAIN_REVIEW_TIMEOUT_MS || 8000);
const DOH_TIMEOUT_MS = Number(process.env.SEMRUSH_DOMAIN_REVIEW_DOH_TIMEOUT_MS || 5000);
const MAX_HTML_CHARS = 120000;
const MAX_HTML_BYTES = MAX_HTML_CHARS * 4;
const HARMFUL_TERMS = ['porn', 'casino', 'gambling', 'betting', 'sex', 'xxx', 'loan', 'payday loan'];
const LINK_NETWORK_TERMS = ['link exchange', 'backlinks', 'submit url', 'directory links', 'seo links'];
const DOH_PROVIDERS = [
  'https://dns.google/resolve',
  'https://cloudflare-dns.com/dns-query',
  'https://dns.quad9.net/dns-query'
];
const INTERNAL_HOST_SUFFIXES = [
  '.local',
  '.localhost',
  '.internal',
  '.lan',
  '.home',
  '.test',
  '.invalid',
  '.example'
];

function isPublicReviewHostname(hostname) {
  const text = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!text) return false;
  if (text === 'localhost') return false;
  if (net.isIP(text)) return false;
  if (!text.includes('.')) return false;
  return !INTERNAL_HOST_SUFFIXES.some((suffix) => text === suffix.slice(1) || text.endsWith(suffix));
}

function normalizeReviewDomain(value) {
  const text = String(value || '').trim();
  if (!text) return '';

  try {
    const parsed = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
    if (!isPublicReviewHostname(hostname)) return '';
    return hostname;
  } catch (_) {
    return '';
  }
}

function parseIpv4Octets(address) {
  const parts = String(address || '').split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => Number(part));
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return octets;
}

function isSafeIpv4Address(address) {
  const octets = parseIpv4Octets(address);
  if (!octets) return false;

  const [a, b, c] = octets;
  if (a === 0) return false;
  if (a === 10) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  if (a >= 224) return false;
  return true;
}

function isFakeDnsIpv4Address(address) {
  const octets = parseIpv4Octets(address);
  if (!octets) return false;
  const [a, b] = octets;
  return a === 198 && (b === 18 || b === 19);
}

function mapIpv6HexTailToIpv4(expanded) {
  if (
    !Array.isArray(expanded) ||
    expanded.length !== 8 ||
    expanded[0] !== '0000' ||
    expanded[1] !== '0000' ||
    expanded[2] !== '0000' ||
    expanded[3] !== '0000' ||
    expanded[4] !== '0000' ||
    expanded[5] !== 'ffff'
  ) {
    return '';
  }

  const high = Number.parseInt(expanded[6], 16);
  const low = Number.parseInt(expanded[7], 16);
  if (!Number.isInteger(high) || !Number.isInteger(low)) return '';

  return [
    (high >> 8) & 0xff,
    high & 0xff,
    (low >> 8) & 0xff,
    low & 0xff
  ].join('.');
}

function expandIpv6Address(address) {
  const input = String(address || '').trim().toLowerCase();
  if (!input) return null;

  const mappedMatch = input.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mappedMatch) {
    return { mappedIpv4: mappedMatch[1] };
  }

  const parts = input.split('::');
  if (parts.length > 2) return null;

  const head = parts[0] ? parts[0].split(':').filter(Boolean) : [];
  const tail = parts[1] ? parts[1].split(':').filter(Boolean) : [];
  if (head.concat(tail).some((part) => !/^[0-9a-f]{1,4}$/i.test(part))) return null;

  const missing = 8 - (head.length + tail.length);
  if ((parts.length === 1 && head.length !== 8) || missing < 0) return null;

  const expanded = parts.length === 2
    ? [...head, ...Array(missing).fill('0'), ...tail]
    : head;

  if (expanded.length !== 8) return null;
  const normalized = expanded.map((part) => part.padStart(4, '0'));
  const mappedIpv4 = mapIpv6HexTailToIpv4(normalized);
  if (mappedIpv4) return { mappedIpv4 };
  return normalized;
}

function isSafeIpv6Address(address) {
  const expanded = expandIpv6Address(address);
  if (!expanded) return false;
  if (expanded.mappedIpv4) return isSafeIpv4Address(expanded.mappedIpv4);

  const prefix8 = expanded[0];
  const prefix16 = Number.parseInt(prefix8, 16);
  if (expanded.every((part) => part === '0000')) return false;
  if (
    expanded[0] === '0000' &&
    expanded[1] === '0000' &&
    expanded[2] === '0000' &&
    expanded[3] === '0000' &&
    expanded[4] === '0000' &&
    expanded[5] === '0000' &&
    expanded[6] === '0000' &&
    expanded[7] === '0001'
  ) {
    return false;
  }
  if ((prefix16 & 0xfe00) === 0xfc00) return false;
  if ((prefix16 & 0xffc0) === 0xfe80) return false;
  if ((prefix16 & 0xff00) === 0xff00) return false;
  if (expanded[0] === '2001' && expanded[1] === '0db8') return false;
  return true;
}

function isSafeResolvedAddress(address) {
  const ipVersion = net.isIP(String(address || '').trim());
  if (ipVersion === 4) return isSafeIpv4Address(address);
  if (ipVersion === 6) return isSafeIpv6Address(address);
  return false;
}

async function resolveHostnameWithDnsOverHttps(hostname, options = {}) {
  const fetchImpl = typeof options.fetch === 'function' ? options.fetch : globalThis.fetch;
  if (typeof fetchImpl !== 'function') return [];

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(new Error('doh_timeout')), DOH_TIMEOUT_MS)
    : null;

  try {
    const answersByAddress = new Map();
    for (const provider of DOH_PROVIDERS) {
      for (const type of ['A', 'AAAA']) {
        const url = `${provider}?name=${encodeURIComponent(hostname)}&type=${type}`;
        const response = await fetchImpl(url, {
          headers: { Accept: 'application/dns-json' },
          signal: controller ? controller.signal : undefined
        }).catch(() => null);
        if (!response || !response.ok) continue;
        const payload = await response.json().catch(() => null);
        for (const answer of Array.isArray(payload && payload.Answer) ? payload.Answer : []) {
          const address = answer && answer.data ? String(answer.data).trim() : '';
          if (net.isIP(address)) answersByAddress.set(address, { address, family: net.isIP(address) });
        }
      }
      if (answersByAddress.size > 0) break;
    }
    return Array.from(answersByAddress.values());
  } catch (_) {
    return [];
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function resolveReviewHostnameSafety(hostname, options = {}) {
  const lookup = typeof options.lookup === 'function'
    ? options.lookup
    : (name) => dns.promises.lookup(name, { all: true, verbatim: true });
  const externalLookup = typeof options.externalLookup === 'function'
    ? options.externalLookup
    : resolveHostnameWithDnsOverHttps;

  let records;
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    const code = error && error.code ? String(error.code) : '';
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ENODATA' || code === 'EAI_NODATA') {
      return { ok: false, reason: 'dns_unresolved', addresses: [] };
    }
    return { ok: false, reason: 'dns_lookup_failed', addresses: [] };
  }

  const addresses = Array.isArray(records)
    ? records.map((record) => record && record.address).filter(Boolean)
    : [];
  if (addresses.length === 0) {
    return { ok: false, reason: 'dns_unresolved', addresses: [] };
  }
  if (addresses.some((address) => !isSafeResolvedAddress(address))) {
    if (addresses.every(isFakeDnsIpv4Address)) {
      const externalRecords = await externalLookup(hostname);
      const externalAddresses = Array.isArray(externalRecords)
        ? externalRecords.map((record) => record && record.address).filter(Boolean)
        : [];
      if (externalAddresses.length > 0 && externalAddresses.every(isSafeResolvedAddress)) {
        return {
          ok: true,
          reason: 'dns_fake_ip_fallback',
          addresses: externalAddresses,
          systemAddresses: addresses
        };
      }
      return {
        ok: false,
        reason: 'dns_fake_ip_fallback_failed',
        addresses,
        externalAddresses
      };
    }
    return { ok: false, reason: 'dns_private_ip', addresses };
  }
  return { ok: true, reason: '', addresses };
}

function buildReviewUrl({ domain, sampleUrl }) {
  const normalizedDomain = normalizeReviewDomain(domain);
  if (!normalizedDomain) return '';

  try {
    const parsedSample = new URL(sampleUrl);
    const sampleDomain = parsedSample.hostname.toLowerCase().replace(/^www\./, '');
    if (
      (parsedSample.protocol === 'http:' || parsedSample.protocol === 'https:') &&
      sampleDomain === normalizedDomain
    ) {
      parsedSample.username = '';
      parsedSample.password = '';
      parsedSample.search = '';
      parsedSample.hash = '';
      return parsedSample.href;
    }
  } catch (_) {
    // Ignore invalid sample URLs and fall back to the domain root.
  }

  return `https://${normalizedDomain}/`;
}

function getReviewUrlHostname(reviewUrl, fallbackDomain) {
  try {
    const parsed = new URL(reviewUrl);
    const hostname = String(parsed.hostname || '').toLowerCase().replace(/\.$/, '');
    if (isPublicReviewHostname(hostname)) return hostname;
  } catch (_) {
    // Fall back below.
  }
  return normalizeReviewDomain(fallbackDomain);
}

function countTermMatches(text, terms) {
  const lower = String(text || '').toLowerCase();
  return terms.filter((term) => lower.includes(term)).length;
}

function classifyDomainReviewHtml({ html, statusCode }) {
  const body = String(html || '').slice(0, MAX_HTML_CHARS);
  if (statusCode >= 400) {
    return { status: 'review_failed', reason: `http_${statusCode}` };
  }

  const harmfulMatches = countTermMatches(body, HARMFUL_TERMS);
  const networkMatches = countTermMatches(body, LINK_NETWORK_TERMS);
  if (harmfulMatches >= 2) return { status: 'blocked', reason: 'harmful_terms' };
  if (networkMatches >= 2) return { status: 'blocked', reason: 'link_network_terms' };
  return { status: 'passed', reason: 'no_blocking_signal' };
}

function classifyDomainReviewResponse({ html, statusCode, locationHeader }) {
  if (statusCode >= 300 && statusCode < 400) {
    const location = String(locationHeader || '').trim();
    if (location) {
      return { status: 'passed', reason: 'redirect_without_blocking_signal' };
    }
  }

  return classifyDomainReviewHtml({ html, statusCode });
}

function sanitizeUrlForServerLog(value) {
  try {
    const parsed = new URL(value);
    parsed.username = '';
    parsed.password = '';
    parsed.search = parsed.search ? '?[redacted]' : '';
    parsed.hash = '';
    return parsed.href;
  } catch (_) {
    return String(value || '').split(/[?#]/)[0].slice(0, 200);
  }
}

function sanitizeReviewFailureReason(value) {
  return String(value == null ? '' : value)
    .replace(/https?:\/\/[^\s"'<>`]+/gi, (match) => sanitizeUrlForServerLog(match))
    .slice(0, 200);
}

function buildPinnedReviewRequestOptions({ reviewUrl, domain, address, timeoutMs = REVIEW_TIMEOUT_MS }) {
  const parsed = new URL(reviewUrl);
  const isHttps = parsed.protocol === 'https:';
  const defaultPort = isHttps ? '443' : '80';
  const port = parsed.port || defaultPort;
  const hostHeader = port === defaultPort ? domain : `${domain}:${port}`;
  const requestOptions = {
    protocol: parsed.protocol,
    hostname: address,
    port,
    method: 'GET',
    path: `${parsed.pathname || '/'}${parsed.search || ''}`,
    timeout: timeoutMs,
    headers: {
      Host: hostHeader,
      'User-Agent': 'Mozilla/5.0 AutoCommentDomainReview/1.0'
    }
  };

  const family = net.isIP(address);
  if (family) requestOptions.family = family;
  if (isHttps) requestOptions.servername = domain;
  return requestOptions;
}

function fetchReviewUrlWithPinnedAddress({
  reviewUrl,
  domain,
  address,
  timeoutMs = REVIEW_TIMEOUT_MS,
  requestImpl
}) {
  const options = buildPinnedReviewRequestOptions({ reviewUrl, domain, address, timeoutMs });
  const transport = requestImpl || (options.protocol === 'https:' ? https.request : http.request);

  return new Promise((resolve, reject) => {
    let settled = false;
    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const req = transport(options, (response) => {
      let receivedBytes = 0;
      let html = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        const textChunk = String(chunk);
        const chunkBytes = Buffer.byteLength(textChunk, 'utf8');
        if (receivedBytes + chunkBytes > MAX_HTML_BYTES) {
          const remainingBytes = Math.max(0, MAX_HTML_BYTES - receivedBytes);
          if (remainingBytes > 0) {
            html += Buffer.from(textChunk, 'utf8').subarray(0, remainingBytes).toString('utf8');
          }
          settled = true;
          req.destroy();
          resolve({
            statusCode: response.statusCode || 0,
            headers: response.headers || {},
            html,
            truncated: true
          });
          return;
        }
        receivedBytes += chunkBytes;
        html += textChunk;
      });
      response.on('end', () => {
        if (settled) return;
        settled = true;
        resolve({
          statusCode: response.statusCode || 0,
          headers: response.headers || {},
          html
        });
      });
      response.on('error', finishReject);
    });

    req.on('error', finishReject);
    req.setTimeout(timeoutMs, () => {
      const error = new Error('timeout');
      error.code = 'ETIMEDOUT';
      req.destroy(error);
    });
    req.end();
  });
}

router.post('/semrush-domain-review', async (req, res) => {
  const startedAt = Date.now();
  const body = req.body || {};
  const domain = normalizeReviewDomain(body.domain);
  const reviewUrl = buildReviewUrl({ domain, sampleUrl: body.sampleUrl });
  const reviewHost = getReviewUrlHostname(reviewUrl, domain);

  if (!domain || !reviewUrl || !reviewHost) {
    return res.status(400).json({ success: false, error: 'INVALID_DOMAIN' });
  }

  const hostSafety = await resolveReviewHostnameSafety(reviewHost);
  if (!hostSafety.ok) {
    const payload = {
      success: true,
      domain,
      status: 'review_failed',
      reason: hostSafety.reason,
      durationMs: Date.now() - startedAt
    };
    console.warn('[semrush-domain-review] rejected', {
      ...payload,
      reviewHost,
      reviewUrl: sanitizeUrlForServerLog(reviewUrl)
    });
    return res.json(payload);
  }

  console.info('[semrush-domain-review] start', {
    domain,
    reviewHost,
    reviewUrl: sanitizeUrlForServerLog(reviewUrl),
    pinnedAddressCount: hostSafety.addresses.length,
    dnsReason: hostSafety.reason || 'system_dns'
  });

  try {
    const response = await fetchReviewUrlWithPinnedAddress({
      reviewUrl,
      domain: reviewHost,
      address: hostSafety.addresses[0],
      timeoutMs: REVIEW_TIMEOUT_MS
    });
    const result = classifyDomainReviewResponse({
      html: response.html,
      statusCode: response.statusCode,
      locationHeader: response.headers && response.headers.location ? response.headers.location : ''
    });
    const payload = {
      success: true,
      domain,
      status: result.status,
      reason: response.truncated && result.status === 'passed' ? 'truncated_no_blocking_signal' : result.reason,
      statusCode: response.statusCode,
      durationMs: Date.now() - startedAt
    };
    console.info('[semrush-domain-review] done', payload);
    return res.json(payload);
  } catch (error) {
    const payload = {
      success: true,
      domain,
      status: 'review_failed',
      reason: error && (error.name === 'AbortError' || error.code === 'ETIMEDOUT')
        ? 'timeout'
        : sanitizeReviewFailureReason((error && error.message) || 'network_error'),
      durationMs: Date.now() - startedAt
    };
    console.warn('[semrush-domain-review] failed', payload);
    return res.json(payload);
  }
});

module.exports = router;
module.exports.normalizeReviewDomain = normalizeReviewDomain;
module.exports.buildReviewUrl = buildReviewUrl;
module.exports.getReviewUrlHostname = getReviewUrlHostname;
module.exports.classifyDomainReviewHtml = classifyDomainReviewHtml;
module.exports.classifyDomainReviewResponse = classifyDomainReviewResponse;
module.exports.buildPinnedReviewRequestOptions = buildPinnedReviewRequestOptions;
module.exports.fetchReviewUrlWithPinnedAddress = fetchReviewUrlWithPinnedAddress;
module.exports.isSafeResolvedAddress = isSafeResolvedAddress;
module.exports.isFakeDnsIpv4Address = isFakeDnsIpv4Address;
module.exports.resolveReviewHostnameSafety = resolveReviewHostnameSafety;
module.exports.resolveHostnameWithDnsOverHttps = resolveHostnameWithDnsOverHttps;
module.exports.sanitizeReviewFailureReason = sanitizeReviewFailureReason;
