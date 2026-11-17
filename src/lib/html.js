// HTML -> testo in stile Jina Reader ("Title / URL Source / Markdown Content" con link [testo](url)).
// Stesso formato della v1, così le euristiche funzionano uguale su lettura diretta e su Jina.
import * as cheerio from 'cheerio';

const MAX = 80000;

export function html2md(html, base) {
  const $ = cheerio.load(html || '');
  $('script,style,noscript,svg,iframe,template').remove();
  const title = $('title').first().text().trim();
  const desc = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '';
  $('a[href]').each((_, a) => {
    const el = $(a);
    let h = el.attr('href') || '';
    try { h = new URL(h, base).href; } catch { return; }
    const t = el.text().trim().replace(/\s+/g, ' ').slice(0, 80);
    el.replaceWith(` [${t}](${h}) `);
  });
  $('h1,h2,h3,h4,h5,h6').each((_, e) => { $(e).prepend('\n' + '#'.repeat(+e.tagName[1]) + ' '); });   // come Jina: "## Titolo"
  $('p,div,li,br,tr,section,article,header,footer,nav,td,h1,h2,h3,h4,h5,h6').each((_, e) => { $(e).append('\n'); });
  const body = $('body').text() || $.root().text();
  const txt = body.replace(/[ \t\u00a0]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  return `Title: ${title}\n\nURL Source: ${base}\n\nMarkdown Content:\n${desc ? desc + '\n' : ''}${txt}`.slice(0, MAX);
}

/** Pagina di dettaglio (directory, sitemap): link esterni del contenuto, h1 e testo, senza header/footer/nav. */
export function parseDetail(html, pageUrl) {
  const $ = cheerio.load(html || '');
  $('header,footer,nav,script,style,noscript').remove();
  const ext = [];
  $('a[href]').each((_, a) => {
    const el = $(a);
    let x;
    try { x = new URL(el.attr('href'), pageUrl); } catch { return; }
    if (!/^https?:$/.test(x.protocol)) return;
    ext.push({ url: x.href, host: x.hostname.replace(/^www\./, '').toLowerCase(), label: (el.text() + ' ' + (el.attr('title') || '')).trim().toLowerCase() });
  });
  return {
    h1: $('h1').first().text().trim().slice(0, 80),
    text: ($('body').text() || '').replace(/\s+/g, ' '),
    links: ext,
  };
}

export function sitemapLocs(xml) {
  return [...String(xml || '').matchAll(/<loc>\s*(?:<!\[CDATA\[)?([^<\]\s]+)/gi)].map(m => m[1].trim());
}
