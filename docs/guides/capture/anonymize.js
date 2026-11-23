// Anonymization layer for guide screenshots.
//
// The dev server runs against the production database, so every screen can
// contain privileged client data. Before ANY screenshot is captured for
// docs/guides/, this script must be injected into the page. It rewrites
// sensitive text in the DOM — client/party/corporation names, matter titles,
// emails, phone numbers, docket numbers, and peso amounts — deterministically,
// so the same real value renders as the same fake value in every screenshot.
//
// IMPORTANT — the sensitive-term list is NOT in this file and must never be
// committed. Generate it at capture time (see terms.sql in this folder), keep
// it outside the repo, and inject it first:
//
//   window.__ANON_TERMS__ = [ { v: 'Real Client Name', t: 'corp' }, ... ];
//   // then evaluate this file
//
// Because the list is large, the capture flow may instead store it once per
// origin: localStorage.setItem('__ANON_TERMS__', JSON.stringify(terms)).
// This file falls back to that key when window.__ANON_TERMS__ is absent, so
// after one seeding only this engine needs re-injecting per page.
//
// Two smaller lists are seeded the same way, from the operator's own firm, and
// are likewise never committed — this file is tenant-neutral:
//
//   window.__ANON_STAFF__        = ['tokens', 'of', 'staff', 'names'];
//   window.__ANON_FIRM_DOMAINS__ = ['firm-mail-domain.example'];
//
// Both default to EMPTY when unseeded, and empty always means "scrub more":
// an empty staff allowlist scrubs staff names along with everyone else's, and
// an empty firm-domain list fakes firm addresses along with everyone else's.
// Never give either one a baked-in default — a stale entry there is a real
// name the sweep would deliberately let through.
//
// Term types: 'person' | 'corp' | 'matter' | 'email' | 'trademark' | 'other',
// plus 'stop' — extra stop-words computed at generation time (tokens of real
// names that are ordinary English words, e.g. institutional parties like
// "Office of the City Prosecutor"). Stop entries are processed first and are
// never replaced; without them, generic UI text gets rewritten too.
//
// After injection, call window.__ANON_CHECK__() — it returns every term that
// still survives in the rendered page. Capture ONLY when it returns [].
//
// Internal staff names are left alone when __ANON_STAFF__ is seeded (they make
// assignment workflows legible) and scrubbed like anyone else's when it is not;
// clients, opposing parties, and their identifiers are never left alone.

(function () {
  'use strict';

  // ---------------------------------------------------------------- hashing
  function fnv(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  // ---------------------------------------------------------------- pools
  const GIVEN = [
    'Andres', 'Beatriz', 'Carlos', 'Dolores', 'Emilio', 'Felisa', 'Gregorio',
    'Herminia', 'Isagani', 'Jocelyn', 'Kristoffer', 'Lourdes', 'Maximo',
    'Nathaniel', 'Olivia', 'Paulino', 'Querubin', 'Rosario', 'Silvestre',
    'Teresita', 'Ulysses', 'Veronica', 'Wilfredo', 'Xandra', 'Ysabel', 'Zosimo',
    'Amparo', 'Bernardo', 'Corazon', 'Danilo', 'Esperanza', 'Florante',
  ];
  const SURNAME = [
    'Abella', 'Bautista', 'Cabrera', 'Dizon', 'Escano', 'Fajardo', 'Galang',
    'Herrera', 'Ilagan', 'Javier', 'Katigbak', 'Lachica', 'Magsino', 'Navarro',
    'Ocampo', 'Padilla', 'Quimson', 'Rosales', 'Salonga', 'Tolentino',
    'Umali', 'Villareal', 'Yorac', 'Zulueta', 'Agbayani', 'Buenaventura',
    'Custodio', 'Dimaculangan', 'Espiritu', 'Fontanilla', 'Gatchalian', 'Hizon',
  ];
  const CORP_STEM = [
    'Rosales', 'Maharlika', 'Kalayaan', 'Bayanihan', 'Luntian', 'Sampaguita',
    'Talisay', 'Malaya', 'Diwata', 'Habagat', 'Amihan', 'Lakandula',
    'Silangan', 'Katipunan', 'Bathala', 'Mayon', 'Banahaw', 'Sierra Madre',
    'Pasig River', 'Taal', 'Palawan Pearl', 'Visayan', 'Mindoro', 'Cagayan',
  ];
  const CORP_KIND = [
    'Manufacturing', 'Trading', 'Development', 'Logistics', 'Agri-Ventures',
    'Realty', 'Food Industries', 'Marketing', 'Construction', 'Shipping',
    'Textiles', 'Pharma',
  ];
  const MATTER_KIND = [
    'Collection Suit', 'Illegal Dismissal Defense', 'SEC Registration',
    'Trademark Opposition', 'Lease Dispute', 'Estate Settlement',
    'Annulment of Title', 'Breach of Contract', 'Labor Arbitration',
    'Tax Assessment Protest', 'Unlawful Detainer', 'Specific Performance',
    'Share Purchase Review', 'Data Privacy Compliance', 'Franchise Agreement',
    'Quieting of Title',
  ];
  const TM_WORD = [
    'LUNTIAN', 'HABAGAT', 'DIWATA', 'SAMPAGUITA', 'MAYON GOLD', 'AMIHAN',
    'TALISAY', 'BATHALA', 'KAPE KILIG', 'SINAG', 'ALON', 'BUKID FRESH',
  ];

  // Tokens never treated as identifying on their own (generic corporate /
  // legal / geographic vocabulary that also appears in ordinary UI text).
  const STOP = new Set([
    'the', 'and', 'of', 'for', 'inc', 'corp', 'corporation', 'company', 'co',
    'holdings', 'group', 'enterprises', 'enterprise', 'industries', 'industry',
    'manufacturing', 'trading', 'development', 'services', 'service',
    'international', 'national', 'philippine', 'philippines', 'manila',
    'quezon', 'makati', 'cebu', 'davao', 'realty', 'construction', 'ventures',
    'venture', 'foundation', 'association', 'cooperative', 'partners',
    'partnership', 'limited', 'incorporated', 'estate', 'heirs', 'spouses',
    'family', 'versus', 'people', 'republic', 'city', 'province', 'bank',
    'insurance', 'general', 'trust', 'matter', 'case', 'et', 'al', 'jr', 'sr',
    'iii', 'legal', 'law', 'office', 'offices',
  ]);

  const PARTICLES = new Set(['de', 'del', 'dela', 'delos', 'delas', 'da', 'san', 'sta', 'santo', 'santa', 'y', 'mac', 'la']);

  // Runtime-seeded string list, same convention as __ANON_TERMS__ below:
  // window global first, localStorage under the same key as the fallback,
  // empty when neither is seeded. Nothing tenant-specific is ever baked into
  // a default here.
  function seededList(key) {
    let v = window[key];
    if (!v) {
      try { v = JSON.parse(localStorage.getItem(key) || '[]'); } catch (_e) { v = []; }
      window[key] = v;
    }
    if (!Array.isArray(v)) return [];
    return v.map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  }

  // Allowlist of internal staff name tokens, which are never rewritten — team
  // names are meant to stay legible in screenshots, and staff surnames are
  // often common enough to collide with party names.
  //
  // FAIL-SAFE: unseeded means an EMPTY allowlist, so staff names are faked
  // along with everyone else's. That is less legible, never less safe — an
  // allowlist that defaulted to anything non-empty would be a standing
  // instruction to leave those exact strings in the screenshot.
  const STAFF = new Set(seededList('__ANON_STAFF__'));

  function pick(pool, seed) { return pool[fnv(seed) % pool.length]; }

  // ------------------------------------------------- fake value composition
  const givenFake = (tok) => pick(GIVEN, 'g:' + tok.toLowerCase());
  const surnameFake = (tok) => pick(SURNAME, 's:' + tok.toLowerCase());
  const corpFake = (tok) => pick(CORP_STEM, 'c:' + tok.toLowerCase());

  function fakeEmail(real) {
    const seed = real.toLowerCase();
    const g = pick(GIVEN, 'eg:' + seed).toLowerCase();
    const s = pick(SURNAME, 'es:' + seed).toLowerCase();
    const dom = pick(['gmail.com', 'yahoo.com', 'outlook.com', 'example.ph'], 'ed:' + seed);
    return g.charAt(0) + '.' + s + '@' + dom;
  }

  function fakeMatterTitle(real) {
    const kind = pick(MATTER_KIND, 'mk:' + real.toLowerCase());
    const who = pick(CORP_STEM, 'mw:' + real.toLowerCase()) + ' ' +
      pick(CORP_KIND, 'mc:' + real.toLowerCase()) + ' Corp.';
    return who + ' — ' + kind;
  }

  function fakeTrademark(real) { return pick(TM_WORD, 'tm:' + real.toLowerCase()); }

  function fakeCorpName(v) {
    const stem = pick(CORP_STEM, 'cf:' + v.toLowerCase());
    const kind = pick(CORP_KIND, 'ck:' + v.toLowerCase());
    const suffix = /\b(inc|incorporated)\b/i.test(v) ? ' Inc.'
      : /\bcorp/i.test(v) ? ' Corp.'
      : /\b(co|company)\b/i.test(v) ? ' Co.' : '';
    return stem + ' ' + kind + suffix;
  }

  function fakePersonFull(v) {
    const toks = tokensOf(v);
    const parts = toks.map((tok, i) => {
      const low = tok.toLowerCase();
      if (PARTICLES.has(low) || tok.length < 3) return null;
      if (STAFF.has(low)) return tok;
      return i === 0 ? givenFake(tok) : surnameFake(tok);
    }).filter(Boolean);
    return parts.join(' ') || pick(SURNAME, 'pf:' + v.toLowerCase());
  }

  function isGeneric(v) {
    const toks = tokensOf(v).filter((tk) => tk.length >= 3);
    return toks.length > 0 && toks.every((tk) => {
      const low = tk.toLowerCase();
      return STOP.has(low) || PARTICLES.has(low) || STAFF.has(low);
    });
  }

  function fakeDigits(run, seed) {
    let out = '';
    for (let i = 0; i < run.length; i++) out += String((fnv(seed + ':' + i) + run.charCodeAt(i)) % 10);
    return out;
  }

  // Single global factor so sums, VAT (12%), and running balances still
  // reconcile inside a screenshot after scaling.
  const AMOUNT_FACTOR = 0.8377;

  // ----------------------------------------------------- replacement table
  // Map of lowercased source → replacement. Applied longest-source-first.
  const table = new Map();

  function addTerm(v, fake) {
    const key = v.trim();
    if (key.length < 3) return;
    if (!table.has(key.toLowerCase())) table.set(key.toLowerCase(), { src: key, fake: fake });
  }

  function tokensOf(v) {
    return v.split(/[^A-Za-zÑñ'-]+/).filter(Boolean);
  }

  function registerPerson(v) {
    const toks = tokensOf(v);
    toks.forEach((tok, i) => {
      const low = tok.toLowerCase();
      if (PARTICLES.has(low) || STOP.has(low) || STAFF.has(low) || tok.length < 3) return;
      addTerm(tok, i === 0 ? givenFake(tok) : surnameFake(tok));
    });
  }

  function registerCorp(v) {
    tokensOf(v).forEach((tok) => {
      const low = tok.toLowerCase();
      if (STOP.has(low) || PARTICLES.has(low) || STAFF.has(low) || tok.length < 4) return;
      addTerm(tok, corpFake(tok));
    });
  }

  function register(entry) {
    const v = (entry.v || '').trim();
    if (!v) return;
    switch (entry.t) {
      // People and companies are replaced BOTH as whole strings and as
      // distinctive tokens. The whole-string entry is what protects names
      // built from ordinary dictionary words ("Brilliant Skin Essentials")
      // that token filtering must skip; generic institutional names
      // ("People of the Philippines") are left alone.
      case 'person':
        // Corporate parties live in the same registry as individuals —
        // route anything with a business suffix through corp handling so
        // it fakes to a company name, not a person.
        if (/\b(inc|incorporated|corp|corporation|company|enterprises|holdings|bank|realty|development|industries|ventures|cooperative|association)\b\.?/i.test(v)) {
          if (!isGeneric(v) || tokensOf(v).length > 1) addTerm(v, fakeCorpName(v));
          registerCorp(v);
          break;
        }
        if (!isGeneric(v) && tokensOf(v).length > 1) addTerm(v, fakePersonFull(v));
        registerPerson(v);
        break;
      case 'corp':
        if (!isGeneric(v) || tokensOf(v).length > 1) addTerm(v, fakeCorpName(v));
        registerCorp(v);
        break;
      // Matter titles and marks are replaced ONLY as whole strings — token
      // registration would map ordinary words ("Trademark", "Collection")
      // to fake names across the entire UI. A title made entirely of
      // stop-words ("Breach of Contract") identifies no one and is left
      // alone — replacing it would also rewrite legitimate UI text and
      // collide with fake output.
      case 'matter': {
        if (!isGeneric(v)) addTerm(v, fakeMatterTitle(v));
        break;
      }
      case 'email': addTerm(v, fakeEmail(v)); break;
      case 'trademark': addTerm(v, fakeTrademark(v)); break;
      default: addTerm(v, fakeMatterTitle(v));
    }
  }

  let TERMS = window.__ANON_TERMS__;
  if (!TERMS) {
    try { TERMS = JSON.parse(localStorage.getItem('__ANON_TERMS__') || '[]'); } catch (_e) { TERMS = []; }
    window.__ANON_TERMS__ = TERMS;
  }
  // Stop entries first — they widen STOP before any token registration.
  TERMS.forEach((e) => { if (e.t === 'stop') STOP.add((e.v || '').trim().toLowerCase()); });
  TERMS.forEach((e) => { if (e.t !== 'stop') register(e); });

  const entries = [...table.values()].sort((a, b) => b.src.length - a.src.length);
  const escaped = entries.map((e) => e.src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const termRe = escaped.length
    ? new RegExp('(?<![A-Za-zÑñ])(?:' + escaped.join('|') + ')(?![A-Za-zÑñ])', 'gi')
    : null;
  const fakeByLower = new Map(entries.map((e) => [e.src.toLowerCase(), e.fake]));

  // Sources that are also produced as fake output can't be meaningfully
  // verified — finding "Javier" in the page usually means some OTHER name was
  // faked to Javier, not that the real Javier leaked. Exclude them from the
  // check (replacement still happens); the capture flow's visual review
  // covers the residue.
  const fakeTokens = new Set();
  entries.forEach((e) => e.fake.split(/[^A-Za-zÑñ'-]+/).forEach((tok) => tok && fakeTokens.add(tok.toLowerCase())));
  const checkable = entries.filter((e) => !fakeTokens.has(e.src.toLowerCase()));
  const checkRe = checkable.length
    ? new RegExp('(?<![A-Za-zÑñ])(?:' + checkable.map((e) => e.src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?![A-Za-zÑñ])', 'gi')
    : null;

  // ------------------------------------------------------- generic regexes
  // The firm's own mail domains, seeded the same way as the staff allowlist.
  // Addresses on them are left as-is so internal senders stay legible.
  //
  // FAIL-SAFE: unseeded means an EMPTY list, so every address — the firm's
  // included — is faked. Less legible, never less safe.
  const FIRM_DOMAINS = seededList('__ANON_FIRM_DOMAINS__');
  const emailRe = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const phoneRe = /(\+63[\s.-]?|\b0)9\d{2}[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
  const amountRe = /(₱|PHP|Php)\s?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)/g;
  const docketRe = /\b((?:G\.R\.|CA-G\.R\.|A\.C\.|A\.M\.|Civil Case|Crim\.? Case|Criminal Case|Spec\. Proc\.|NLRC|SEC|IPC|LRC|NPC|BIR|CTA|Docket)[\s.]*(?:Nos?\.?)?[\s]*)((?:[A-Z]{0,4}[-–]?\d[\d–-]*)+)/g;
  // Letter-prefixed reference codes (court dockets like SSC-24-001-25,
  // invoice numbers like PREFIX-2026-06-003) — swap the digits, keep the shape.
  const codeRe = /\b[A-Z]{1,6}-\d[\dA-Z-]{3,}\b/g;
  // Pure numeric codes with three+ segments (matter codes like 162-20-1);
  // first segment must not read as a year so ISO dates survive.
  const numCodeRe = /\b(?!(?:19|20)\d{2}-)\d{1,4}-\d{1,4}-[\d-]+\b/g;

  function scaleAmount(sym, num) {
    const raw = parseFloat(num.replace(/,/g, ''));
    if (!isFinite(raw) || raw === 0) return sym + num;
    const scaled = raw * AMOUNT_FACTOR;
    const hasDec = num.indexOf('.') !== -1;
    const fixed = scaled.toFixed(hasDec ? (num.length - num.indexOf('.') - 1) : 0);
    const parts = fixed.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return sym + (sym === '₱' ? '' : ' ') + parts.join('.');
  }

  function transform(text) {
    let out = text;
    if (termRe) {
      out = out.replace(termRe, (m) => fakeByLower.get(m.toLowerCase()) || m);
    }
    out = out.replace(emailRe, (m) => {
      const dom = m.split('@')[1].toLowerCase();
      return FIRM_DOMAINS.some((d) => dom === d || dom.endsWith('.' + d)) ? m : fakeEmail(m);
    });
    out = out.replace(phoneRe, (m) => {
      const digits = m.replace(/\D/g, '');
      const fake = fakeDigits(digits, digits);
      let di = 0;
      // keep the original shape and carrier prefix; swap the subscriber digits
      return m.replace(/\d/g, (d) => (++di <= 4 ? d : fake[di - 1]));
    });
    out = out.replace(amountRe, (_m, sym, num) => scaleAmount(sym, num));
    out = out.replace(docketRe, (_m, prefix, num) => prefix + num.replace(/\d+/g, (d) => fakeDigits(d, 'dk:' + num)));
    // years inside codes (invoice numbers) stay readable
    const keepYear = (d) => /^(19|20)\d{2}$/.test(d);
    out = out.replace(codeRe, (m) => m.replace(/\d+/g, (d) => (keepYear(d) ? d : fakeDigits(d, 'cd:' + m))));
    out = out.replace(numCodeRe, (m) => m.replace(/\d+/g, (d) => (keepYear(d) ? d : fakeDigits(d, 'nc:' + m))));
    return out;
  }

  // ------------------------------------------------------------- DOM sweep
  const lastOutput = new WeakMap();
  const ATTRS = ['title', 'alt', 'placeholder', 'aria-label'];

  function sweep(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        const tag = p.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let node;
    while ((node = walker.nextNode())) {
      const cur = node.nodeValue;
      if (!cur || lastOutput.get(node) === cur) continue;
      const next = transform(cur);
      if (next !== cur) node.nodeValue = next;
      lastOutput.set(node, next);
    }
    const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
    all.forEach((el) => {
      ATTRS.forEach((a) => {
        const v = el.getAttribute && el.getAttribute(a);
        if (v) {
          const next = transform(v);
          if (next !== v) el.setAttribute(a, next);
        }
      });
      if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.value) {
        const next = transform(el.value);
        if (next !== el.value) el.value = next;
      }
    });
  }

  sweep(document.body);
  document.title = transform(document.title);

  // Synchronous full re-sweep for capture tooling — call right before
  // checking/screenshotting so late-rendered content can't race the
  // debounced MutationObserver pass.
  window.__ANON_SWEEP__ = function () { sweep(document.body); };

  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; sweep(document.body); }, 150);
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });

  // ---------------------------------------------------------- verification
  // Returns replacement SOURCES still present in the rendered text — i.e.
  // strings the sweep was supposed to rewrite but didn't reach. Empty array =
  // safe to capture.
  window.__ANON_CHECK__ = function () {
    if (!checkRe) return [];
    const hay = document.body.innerText;
    const found = hay.match(checkRe) || [];
    return [...new Set(found.map((s) => s.toLowerCase()))];
  };

  window.__ANON_READY__ = true;
})();
