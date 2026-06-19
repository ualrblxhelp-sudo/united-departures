// utils/newsroom.js — Watches United's official press-release feed and posts a summary
// of each NEW article to the Hemispheres channel.
//
// Source:  https://united.mediaroom.com/news-releases  (server-rendered, reliable)
// Summary: Anthropic API when ANTHROPIC_API_KEY is set, else United's own description.
// Dedupe:  models/NewsArticle (Mongo) — seeded on first run so no backlog is dumped.
//
// Optional env vars:
//   ANTHROPIC_API_KEY    enables AI summaries (falls back to the article's own blurb if absent)
//   NEWS_SUMMARY_MODEL   default 'claude-haiku-4-5-20251001'
//   NEWS_POLL_MINUTES    default 15

const NewsArticle = require('../models/NewsArticle');

// ---- Configuration ----
var MAIN_GUILD_ID = '1007704123312967760';
var HEMISPHERES_CHANNEL_ID = '1406863436746461235';

var BASE = 'https://united.mediaroom.com';
var LIST_URL = BASE + '/news-releases?l=25';

var DOC_MARKUP = '<:e_document:1397829552797126696>';

var SUMMARY_MODEL = process.env.NEWS_SUMMARY_MODEL || 'claude-haiku-4-5-20251001';
var POLL_MINUTES = parseInt(process.env.NEWS_POLL_MINUTES || '15', 10);
if (!POLL_MINUTES || POLL_MINUTES < 5) POLL_MINUTES = 15;

var USER_AGENT = 'Mozilla/5.0 (compatible; UnitedDeparturesBot/1.0; newsroom watcher)';
var MAX_CANDIDATES = 15;   // only inspect the newest N entries per cycle

var _running = false;      // prevents overlapping cycles
var _started = false;

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

// ---- HTTP ----
async function httpGet(url) {
    if (typeof fetch !== 'function') {
        console.error('[Newsroom] global fetch unavailable — needs Node 18+.');
        return null;
    }
    try {
        var res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,application/xhtml+xml' } });
        if (!res.ok) {
            console.error('[Newsroom] GET ' + url + ' -> HTTP ' + res.status);
            return null;
        }
        return await res.text();
    } catch (err) {
        console.error('[Newsroom] GET ' + url + ' failed:', err.message);
        return null;
    }
}

// ---- Parsing ----
// Pull article permalink slugs from the list page, newest first, de-duplicated in order.
// United permalinks look like "/2026-06-02-Title-Slug" or occasionally "/Title-Slug".
function parseListSlugs(html) {
    var slugs = [];
    var seen = {};
    var re = /href=["'](?:https?:\/\/united\.mediaroom\.com)?\/([^"'#?\s>]+)["']/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
        var slug = m[1].replace(/\/$/, '');
        if (seen[slug]) continue;
        if (!looksLikeArticleSlug(slug)) continue;
        seen[slug] = true;
        slugs.push(slug);
        if (slugs.length >= MAX_CANDIDATES) break;
    }
    return slugs;
}

function looksLikeArticleSlug(slug) {
    if (!slug) return false;
    var lower = slug.toLowerCase();
    // Exclude known non-article paths.
    var bad = ['news-releases', 'emailalerts', 'rss', 'images', 'image', 'multimedia',
               'contact', 'about', 'category', 'search', 'login', 'css', 'js', 'feed'];
    for (var i = 0; i < bad.length; i++) {
        if (lower === bad[i] || lower.indexOf(bad[i] + '/') === 0 || lower.indexOf('/' + bad[i]) !== -1) return false;
    }
    if (lower.indexOf('.') !== -1) return false;       // file assets
    // Dated permalink, or a long Title-Case hyphenated slug (real article).
    if (/^20\d{2}-\d{2}-\d{2}-/.test(slug)) return true;
    var hyphens = (slug.match(/-/g) || []).length;
    return hyphens >= 4 && slug.length >= 25;
}

function metaTag(html, name) {
    // Matches <meta property="og:title" content="..."> or <meta name="description" content="...">
    var patterns = [
        new RegExp('<meta[^>]+(?:property|name)=["\']' + name + '["\'][^>]+content=["\']([^"\']*)["\']', 'i'),
        new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]+(?:property|name)=["\']' + name + '["\']', 'i'),
    ];
    for (var i = 0; i < patterns.length; i++) {
        var m = html.match(patterns[i]);
        if (m) return decodeEntities(m[1]).trim();
    }
    return '';
}

function canonicalUrl(html) {
    var m = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i) ||
            html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
    return m ? decodeEntities(m[1]).trim() : '';
}

function decodeEntities(s) {
    if (!s) return '';
    return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
            .replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
}

// Strip HTML to readable text, dropping boilerplate after the press release body.
function extractBodyText(html) {
    var body = html;
    var lower = body.toLowerCase();
    var cut = lower.indexOf('about united');
    if (cut === -1) cut = lower.indexOf('source united');
    if (cut !== -1) body = body.slice(0, cut);
    body = body.replace(/<script[\s\S]*?<\/script>/gi, ' ')
               .replace(/<style[\s\S]*?<\/style>/gi, ' ')
               .replace(/<[^>]+>/g, ' ');
    body = decodeEntities(body).replace(/\s+/g, ' ').trim();
    return body;
}

// Removes the " - Jun 2, 2026" style suffix mediaroom appends to og:title.
function cleanTitle(title) {
    return (title || '').replace(/\s*[-\u2013]\s*[A-Z][a-z]{2,8}\.?\s+\d{1,2},\s+\d{4}\s*$/, '').trim();
}

// Fetch + parse a single article page. Returns null if it isn't a real press release.
async function fetchArticle(slug) {
    var url = BASE + '/' + slug;
    var html = await httpGet(url);
    if (!html) return null;

    var ogTitle = cleanTitle(metaTag(html, 'og:title'));
    var description = metaTag(html, 'og:description') || metaTag(html, 'description');
    var canonical = canonicalUrl(html);
    var siteName = metaTag(html, 'og:site_name');

    // Validate: a genuine United press release has a title and newsroom markers.
    var isRelease = !!ogTitle &&
        (/newsroom/i.test(canonical) || /newsroom/i.test(siteName) || /source united/i.test(html));
    if (!isRelease) return null;

    var bodyText = extractBodyText(html);
    // Prefer the consumer united.com canonical link; fall back to the mediaroom URL.
    var link = (canonical && /united\.com/i.test(canonical)) ? canonical : url;

    return {
        articleId: slug,
        title: ogTitle,
        description: description || '',
        body: bodyText,
        url: link,
        sourceUrl: url,
    };
}

// ---- Summary ----
async function aiSummarize(article) {
    var key = process.env.ANTHROPIC_API_KEY;
    if (!key || typeof fetch !== 'function') return null;

    var material = article.body && article.body.length > 200 ? article.body : (article.description || article.title);
    var prompt =
        'You are writing a short news blurb for an aviation community Discord. ' +
        'Summarize the following United Airlines press release in 2-3 sentences, ' +
        'highlighting the key breaking news in a clear, neutral tone. ' +
        'Return ONLY the summary text — no title, preamble, bullet points, or sign-off.\n\n' +
        'Headline: ' + article.title + '\n\n' +
        'Article:\n' + material.slice(0, 8000);

    try {
        var res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-api-key': key,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: SUMMARY_MODEL,
                max_tokens: 320,
                messages: [{ role: 'user', content: prompt }],
            }),
        });
        if (!res.ok) {
            console.error('[Newsroom] AI summary HTTP ' + res.status);
            return null;
        }
        var data = await res.json();
        var text = (data && Array.isArray(data.content) ? data.content : [])
            .filter(function(b) { return b && b.type === 'text'; })
            .map(function(b) { return b.text; })
            .join('')
            .trim();
        return text || null;
    } catch (err) {
        console.error('[Newsroom] AI summary error:', err.message);
        return null;
    }
}

function fallbackSummary(article) {
    if (article.description) return article.description;
    var body = article.body || '';
    if (!body) return article.title;
    // First ~2 sentences, capped.
    var slice = body.slice(0, 400);
    var lastStop = slice.lastIndexOf('. ');
    if (lastStop > 120) slice = slice.slice(0, lastStop + 1);
    return slice.trim();
}

async function buildSummary(article) {
    var ai = await aiSummarize(article);
    return ai || fallbackSummary(article);
}

// ---- Post ----
function buildPostContent(article, summary) {
    var lines = ['**' + article.title + '**', ''].concat(String(summary).split('\n'));
    var quoted = lines.map(function(l) { return l.length ? '> ' + l : '>'; }).join('\n');

    var content =
        '> ### ' + DOC_MARKUP + ' United Hemispheres\n' +
        '-# **Worldwide Press Office** \u2014 Good Leads the Way\n' +
        '\n' +
        quoted + '\n' +
        '\n' +
        '-# Check out the article [here](' + article.url + ').';

    if (content.length > 2000) content = content.slice(0, 1997) + '...';
    return content;
}

async function postArticle(client, article, summary) {
    var guild = await client.guilds.fetch(MAIN_GUILD_ID);
    var channel = await guild.channels.fetch(HEMISPHERES_CHANNEL_ID);
    if (!channel || typeof channel.send !== 'function') {
        console.error('[Newsroom] Hemispheres channel not found or not text-based.');
        return false;
    }
    await channel.send({ content: buildPostContent(article, summary), allowedMentions: { parse: [] } });
    return true;
}

// ---- Main cycle ----
async function runCheck(client, opts) {
    opts = opts || {};
    if (_running) return;
    _running = true;
    try {
        var seed = opts.seed;
        var html = await httpGet(LIST_URL);
        if (!html) return;

        var slugs = parseListSlugs(html);
        if (slugs.length === 0) {
            console.error('[Newsroom] No article links parsed from the list page.');
            return;
        }

        // Oldest-first so multiple new posts arrive in chronological order.
        slugs.reverse();

        var posted = 0, seeded = 0;
        for (var i = 0; i < slugs.length; i++) {
            var slug = slugs[i];
            var exists = await NewsArticle.findOne({ articleId: slug });
            if (exists) continue;

            var article = await fetchArticle(slug);
            await sleep(800); // be polite between page fetches

            if (!article) {
                // Not a press release (or fetch failed) — remember so we don't re-inspect it.
                await NewsArticle.create({ articleId: slug, ignored: true, posted: false }).catch(function() {});
                continue;
            }

            if (seed) {
                await NewsArticle.create({
                    articleId: article.articleId, title: article.title,
                    url: article.url, sourceUrl: article.sourceUrl,
                    posted: false, seeded: true,
                }).catch(function() {});
                seeded++;
                continue;
            }

            var summary = await buildSummary(article);
            var ok = await postArticle(client, article, summary);
            await NewsArticle.create({
                articleId: article.articleId, title: article.title,
                url: article.url, sourceUrl: article.sourceUrl,
                summary: summary, posted: !!ok,
            }).catch(function() {});
            if (ok) {
                posted++;
                console.log('[Newsroom] Posted: ' + article.title);
                await sleep(1200);
            }
        }

        if (seed) console.log('[Newsroom] Seeded ' + seeded + ' existing article(s) — none posted (first run).');
        else if (posted) console.log('[Newsroom] Posted ' + posted + ' new article(s).');
    } catch (err) {
        console.error('[Newsroom] Cycle error:', err.message);
    } finally {
        _running = false;
    }
}

// ---- Public entry point ----
function startNewsroomWatcher(client) {
    if (_started) return;
    _started = true;

    (async function() {
        try {
            var count = await NewsArticle.estimatedDocumentCount();
            if (count === 0) {
                console.log('[Newsroom] First run — seeding current articles without posting.');
                await runCheck(client, { seed: true });
            } else {
                await runCheck(client, { seed: false }); // catch up anything published while offline
            }
        } catch (err) {
            console.error('[Newsroom] Initial run error:', err.message);
        }
    })();

    setInterval(function() {
        runCheck(client, { seed: false });
    }, POLL_MINUTES * 60 * 1000);

    console.log('[Newsroom] Watcher started (every ' + POLL_MINUTES + ' min).');
}

module.exports = {
    startNewsroomWatcher: startNewsroomWatcher,
    // exported for testing / manual runs
    runCheck: runCheck,
    parseListSlugs: parseListSlugs,
    looksLikeArticleSlug: looksLikeArticleSlug,
    buildPostContent: buildPostContent,
    fetchArticle: fetchArticle,
};
