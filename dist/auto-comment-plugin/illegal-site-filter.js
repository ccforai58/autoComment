(function initIllegalSiteFilter(root) {
  'use strict';

  const RESULT_BLOCKED_ILLEGAL = 'blocked_illegal';

  const ADULT_TERMS = [
    'porn', 'porno', 'pornography', 'pornhub', 'xxx', 'xvideo', 'xvideos',
    'xhamster', 'xnxx', 'sex', 'sexy', 'adult', 'adultvideo',
    'adultvideos', 'sexvideo', 'sexvideos', 'sextube', 'sexcam', 'webcam',
    'camgirl', 'camgirls', 'camsex', 'livecam', 'nude', 'nudes', 'nudity',
    'hentai', 'erotic', 'erotica', 'fetish', 'bdsm', 'escort', 'escorts',
    'brothel', 'hookup', 'hookups', 'milf', 'teenporn', 'redtube',
    'onlyfans', 'stripchat', 'chaturbate', 'sexchat', 'dirtychat',
    'cybersex', 'upskirt', 'creampie', 'gangbang', 'blowjob', 'handjob',
    'analporn', 'lesbianporn', 'gayporn', 'hardcore', 'softcore',
    'jav', 'avgle',
    '色情', '成人', '情色', '三级片', '裸聊', '约炮', '成人视频'
  ];

  const GAMBLING_TERMS = [
    'casino', 'bet', 'bets', 'bet365', 'betway', '1xbet', '188bet', 'sbobet',
    'm88', 'gambling', 'gamble', 'betting', 'sportsbook', 'bookmaker',
    'wager', 'wagering', 'jackpot', 'roulette', 'roulettewheel',
    'blackjack', 'baccarat', 'poker', 'pokertournament', 'slot', 'slots',
    'slotmachine', 'slotgames', 'lottery', 'sweepstakes', 'odds',
    'oddschecker', 'parlay', 'croupier', 'craps', 'keno', 'bingo',
    'pachinko', 'bookie', 'freebets', 'livecasino', 'onlinecasino',
    'cryptocasino', 'sportsbetting', 'footballbetting', 'horsebetting',
    'racebook', 'gamblingbonus', 'casinobonus', 'depositbonus',
    'highroller', 'tipster', 'megaways', 'provablyfair', 'livebetting',
    'inplaybetting', 'accumulator', 'betslip', 'wagerbonus',
    'roulettebonus', 'roulettebonuscasino',
    '博彩', '赌博', '赌场', '娱乐城', '体育投注', '现金网', '老虎机',
    '百家乐', '体育投注', '彩票', '下注', '盘口', '赔率', '德州扑克'
  ];

  const PAGE_CONTEXT_ALLOW_TERMS = [
    '反赌博', '禁赌', '戒赌', '预防赌博', '赌博成瘾', '法律', '法规', '新闻',
    '研究', '报告', '教育', '治理', '投诉', '举报', 'anti gambling',
    'gambling addiction', 'prevention', 'regulation', 'law', 'news',
    'research', 'education'
  ];

  const HOST_ALLOW_TERMS = [
    'sexeducation', 'essex', 'sussex', 'middlesex', 'casinohotel'
  ];

  function normalizeText(value) {
    return String(value || '').toLowerCase();
  }

  function parseUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      return url;
    } catch (_) {
      return null;
    }
  }

  function normalizeHost(hostname) {
    return normalizeText(hostname).replace(/^www\./, '');
  }

  function hostLooksAllowed(host) {
    return HOST_ALLOW_TERMS.some((term) => host.includes(term));
  }

  function isAsciiTerm(term) {
    return /^[a-z0-9]+$/i.test(term);
  }

  function termInText(text, term) {
    if (!text || !term) return false;
    const lowerTerm = normalizeText(term);
    if (!isAsciiTerm(lowerTerm)) return text.includes(lowerTerm);

    const escaped = lowerTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text);
  }

  function termInHost(host, term) {
    if (!host || !term) return false;
    const lowerTerm = normalizeText(term);
    if (!isAsciiTerm(lowerTerm)) return host.includes(lowerTerm);

    const labels = host.split(/[.\-_]+/).filter(Boolean);
    if (lowerTerm.length <= 3) {
      return labels.some((label) => label === lowerTerm || label.startsWith(`${lowerTerm}365`) || label.startsWith(`${lowerTerm}888`));
    }

    return labels.some((label) => label.includes(lowerTerm));
  }

  function collectMatches(text, terms) {
    const matches = [];
    const normalized = normalizeText(text);
    for (const term of terms) {
      if (termInText(normalized, term)) matches.push(term);
    }
    return matches;
  }

  function collectHostMatches(host, terms) {
    const matches = [];
    for (const term of terms) {
      if (termInHost(host, term)) matches.push(term);
    }
    return matches;
  }

  function buildReason(category, matches, source) {
    const label = category === 'adult' ? '色情/成人' : '赌博/博彩';
    const matched = matches.slice(0, 5).join(', ');
    return `非法网站拦截：${label}${matched ? `（命中：${matched}）` : ''}${source ? `，来源：${source}` : ''}`;
  }

  function result(blocked, category, matches, source, score) {
    return {
      blocked,
      result: blocked ? RESULT_BLOCKED_ILLEGAL : null,
      category: category || null,
      matches: matches || [],
      source: source || null,
      score: score || 0,
      reason: blocked ? buildReason(category, matches || [], source) : ''
    };
  }

  function evaluateUrl(rawUrl, options = {}) {
    const url = parseUrl(rawUrl);
    if (!url) return result(false, null, [], null, 0);

    const host = normalizeHost(url.hostname);
    if (hostLooksAllowed(host)) return result(false, null, [], null, 0);

    const sourceDomain = normalizeHost(options.sourceDomain || '');
    const hostText = [host, sourceDomain].filter(Boolean).join(' ');
    const pathText = normalizeText(`${url.pathname} ${url.search}`);

    const adultHostMatches = collectHostMatches(hostText, ADULT_TERMS);
    if (adultHostMatches.length > 0) {
      return result(true, 'adult', adultHostMatches, 'domain', 10);
    }

    const gamblingHostMatches = collectHostMatches(hostText, GAMBLING_TERMS);
    if (gamblingHostMatches.length > 0) {
      return result(true, 'gambling', gamblingHostMatches, 'domain', 10);
    }

    const adultPathMatches = collectMatches(pathText, ADULT_TERMS);
    if (adultPathMatches.length >= 2) {
      return result(true, 'adult', adultPathMatches, 'url_path', 7);
    }

    const gamblingPathMatches = collectMatches(pathText, GAMBLING_TERMS);
    if (gamblingPathMatches.length >= 2) {
      return result(true, 'gambling', gamblingPathMatches, 'url_path', 7);
    }

    return result(false, null, [], null, 0);
  }

  function evaluatePage(rawUrl, pageInfo = {}) {
    const urlResult = evaluateUrl(rawUrl, { sourceDomain: pageInfo.sourceDomain });
    if (urlResult.blocked) return urlResult;

    const title = normalizeText(pageInfo.title || '');
    const meta = normalizeText(`${pageInfo.description || ''} ${pageInfo.keywords || ''}`);
    const bodyText = normalizeText(pageInfo.text || '').slice(0, 12000);
    const combined = `${title} ${meta} ${bodyText}`;

    const allowMatches = collectMatches(combined, PAGE_CONTEXT_ALLOW_TERMS);
    const allowPenalty = Math.min(allowMatches.length * 2, 4);

    const adultMatches = collectMatches(combined, ADULT_TERMS);
    const gamblingMatches = collectMatches(combined, GAMBLING_TERMS);

    const titleAndMeta = `${title} ${meta}`;
    const adultStrong = collectMatches(titleAndMeta, ADULT_TERMS).length;
    const gamblingStrong = collectMatches(titleAndMeta, GAMBLING_TERMS).length;

    const adultScore = adultMatches.length + adultStrong * 3 - allowPenalty;
    const gamblingScore = gamblingMatches.length + gamblingStrong * 3 - allowPenalty;

    if (adultScore >= 6 && adultMatches.length >= 2) {
      return result(true, 'adult', adultMatches, 'page_content', adultScore);
    }

    if (gamblingScore >= 6 && gamblingMatches.length >= 2) {
      return result(true, 'gambling', gamblingMatches, 'page_content', gamblingScore);
    }

    return result(false, null, [], null, Math.max(adultScore, gamblingScore, 0));
  }

  root.AutoCommentIllegalSiteFilter = {
    RESULT_BLOCKED_ILLEGAL,
    evaluateUrl,
    evaluatePage
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
