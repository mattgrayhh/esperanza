// Esperanza / O'Neill static replica — served by Cloudflare Workers Static Assets.
// The static site lives in ./public (built by build.mjs); this Worker runs first
// (assets.run_worker_first) so it owns headers, the same-origin API proxy, the
// analytics/XHR stubs, and the 404 fallback — all edge logic in one place that
// survives rebuilds.

import { REDIRECTS } from "./redirects.mjs";
import { patchHtmlLocale, stripEsPrefix, isEsPath, toEsPath, ES_PREFIX } from "./locale.mjs";
import {
  OFFER_PREFIX, offerPath, offerIdFromPath, isOfferNamespacePath, legacyAliasFromPath,
  findHubPromoById, LEGACY_ALIAS_PROMO_IDS,
} from "./promo-identity.mjs";
import { bakeOfferShell, OFFER_STRINGS } from "./offer-shell.mjs";

const LIVE = "https://www.esperanzahomes.com";
const API = "https://esperanza-api.round-base-ed8c.workers.dev";
let staleQmiRedirects;

// Read only after a static 404; healthy pages never fetch this. Cache per isolate.
async function staleQmiRedirectTarget(request, env, path) {
  if (!staleQmiRedirects) {
    staleQmiRedirects = env.ASSETS.fetch(new Request(new URL("/stale-qmi-redirects.json", request.url)))
      .then(async (response) => {
        if (response.status !== 200) return {};
        const manifest = await response.json();
        return manifest.redirects || manifest; // supports the first manifest format too
      }).catch(() => ({}));
  }
  return (await staleQmiRedirects)[path] || null;
}

// A manifest can lag a marketing republish. Unknown/API failure fails open to the live shell.
async function qmiSlugIsPublished(slug, env) {
  try {
    const headers = new Headers({ accept: "application/json", origin: LIVE });
    const request = new Request(API + "/api/public/qmi", { headers, redirect: "manual" });
    let response = env.API ? await env.API.fetch(request) : null;
    if (!response || response.status === 503) response = await fetch(new Request(request, { redirect: "manual" }), { cf: { cacheTtl: 300 } });
    if (!response.ok) return null;
    const { homes = [] } = await response.json();
    return homes.some((home) => {
      const fields = home.fields || home;
      return fields.slug === slug || fields.seo_slug === slug;
    });
  } catch { return null; }
}

// ── Promotion detail route ────────────────────────────────────────────────────
// /incentives/offer/<promotion-id>/ is ONE committed shell (render-offer.mjs) that this
// route bakes with the live promotion at the edge. See promo-identity.mjs for why the
// namespace is ID-keyed rather than title-derived.

const OFFER_HUB = "/incentives/";

// Where the offer route's decision is observable without parsing HTML, so acceptance
// probes can tell a retirement from an upstream failure by header alone.
const OFFER_STATE_HEADER = "X-Offer-State";

/**
 * The public promotions payload, or `null` for ANY failure — transport, non-2xx, or a
 * body that is not `{promotions: [...]}`.
 *
 * `null` and `[]` mean different things on purpose. `[]` is the API answering honestly
 * that no promotion exists, so an id that does not resolve is genuinely retired. `null`
 * is "we do not know", which must never be rendered as retirement: a 5-minute API outage
 * would otherwise permanently redirect every live offer URL to the hub.
 */
async function fetchPromotions(env) {
  try {
    const headers = new Headers({ accept: "application/json", origin: LIVE });
    const sub = new Request(API + "/api/public/promotions", { headers, redirect: "manual" });
    // Same env.API-then-plain-fetch pattern as qmiSlugIsPublished: the service binding is
    // a 503 stub under `wrangler dev`.
    let resp = env.API ? await env.API.fetch(sub) : null;
    if (!resp || resp.status === 503) resp = await fetch(new Request(sub, { redirect: "manual" }), { cf: { cacheTtl: 60 } });
    if (!resp.ok) return null;
    const body = await resp.json();
    const promotions = body && body.promotions;
    return Array.isArray(promotions) ? promotions : null;
  } catch { return null; }
}

/**
 * An offer URL whose id does not name a hub-published promotion (unknown, inactive,
 * showIncentivePage=false, or a charset-invalid id). Sends the visitor to the hub, which
 * lists what IS available, instead of a contentless 200 (plan Phase 2.2).
 *
 * 302, NOT 301 — a deliberate deviation from the plan's wording. Publication state is
 * mutable: an offer that is unpublished today can be republished tomorrow, and a
 * permanent redirect would poison its canonical URL in every browser and POP cache long
 * after it came back. This file already draws that line for asset redirects ("an
 * immutable-cached redirect poisons that URL for a whole POP", below). `no-store` keeps
 * even the temporary redirect out of caches, so retirement tracks D1 within the API's
 * own 60s cache window.
 */
function offerRetire(url, esPrefix) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: url.origin + esPrefix + OFFER_HUB,
      "Cache-Control": "no-store",
      [OFFER_STATE_HEADER]: "retired",
      ...SEC,
    },
  });
}

/** The committed shell for a locale, falling back to the English twin when /es/ has not
 *  been re-baked yet — Spanish is additive (same rule as the 404 branch), so a missing
 *  twin must not turn a live offer into an error. */
async function offerShellHtml(request, env, esPrefix) {
  for (const prefix of esPrefix ? [esPrefix, ""] : [""]) {
    const resp = await env.ASSETS.fetch(new Request(new URL(prefix + OFFER_PREFIX, request.url)));
    if (resp && resp.status === 200) return resp.text();
  }
  return null;
}

/**
 * Upstream failure state: transport error, non-2xx, or malformed payload. Serves the
 * shell with an explicit "temporarily unavailable" message and the template's noindex
 * intact, under a 503 so crawlers and monitors read it as a transient fault.
 *
 * This is emphatically NOT retirement. A redirect here would tell every cache the offer
 * is gone because the API blipped; a 200 would let a crawler index a contentless page as
 * the offer. The island still runs and can fill the hooks from the browser's own request,
 * so a visitor often sees the real offer anyway.
 */
async function offerUpstreamResponse(request, env, esPrefix, lang, p) {
  const shell = await offerShellHtml(request, env, esPrefix);
  const strings = OFFER_STRINGS[lang] || OFFER_STRINGS.en;
  const body = shell === null
    ? strings.upstream
    : bakeOfferShell(patchHtmlLocale(shell, p), null, { esPrefix, lang, state: strings.upstream });
  return new Response(body, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Retry-After": "60",
      [OFFER_STATE_HEADER]: "upstream",
      ...SEC,
    },
  });
}

/**
 * Resolve and serve /incentives/offer/<id>/ (either locale). Returns null only when the
 * path is not in the namespace at all, so the caller can fall through.
 */
async function offerRouteResponse(request, env, { url, p, bare, esPrefix }) {
  const lang = esPrefix ? "es" : "en";

  // Legacy detail slugs are hand-curated inbound compatibility (LEGACY_ALIAS_PROMO_IDS).
  // Deliberately NO payload fetch here: the alias→id mapping is permanent data, so this
  // hop can be a real 301, and the mutable publication decision is left to the canonical
  // URL below (which answers it with a cache-safe 302). Verifying the promotion here
  // instead would make a PERMANENT redirect depend on live state — the poisoning bug the
  // retirement comment describes.
  const alias = legacyAliasFromPath(bare);
  if (alias) {
    // `?promo=<id>` is what the CURRENT hub cards emit (promotions-live.js promoHref) and
    // what any bookmark or email from the live site carries, so it is real inbound traffic.
    // It names the promotion EXACTLY, where the alias table can only name the one tier the
    // slug advertised — the four Flex tiers all share one legacy slug. Honor it when the id
    // passes the charset gate, and fall back to the curated table otherwise. Still a 301:
    // id-to-path is a pure deterministic mapping, so this hop cannot go stale (the mutable
    // publication question is answered by the canonical URL's own 302).
    const queried = offerPath(url.searchParams.get("promo") || "");
    const target = queried || offerPath(LEGACY_ALIAS_PROMO_IDS[alias]) || OFFER_HUB;
    return new Response(null, {
      status: 301,
      headers: {
        Location: url.origin + esPrefix + target,
        "Cache-Control": "public, max-age=3600",
        [OFFER_STATE_HEADER]: "alias",
        ...SEC,
      },
    });
  }

  if (!isOfferNamespacePath(bare)) return null;

  // An id that fails the charset gate (or the bare namespace root, which is the template)
  // must not fall through to the static-asset fetch — that would ship the un-baked shell
  // as a contentless 200 under an arbitrary URL.
  const id = offerIdFromPath(bare);
  if (!id) return offerRetire(url, esPrefix);

  const promos = await fetchPromotions(env);
  if (promos === null) return offerUpstreamResponse(request, env, esPrefix, lang, p);

  const promo = findHubPromoById(promos, id);
  if (!promo) return offerRetire(url, esPrefix);

  const shell = await offerShellHtml(request, env, esPrefix);
  // The committed shell is missing from the deploy: treat as an upstream-class fault
  // rather than retiring a promotion that D1 says is live.
  if (shell === null) return offerUpstreamResponse(request, env, esPrefix, lang, p);

  const html = bakeOfferShell(patchHtmlLocale(shell, p), promo, { esPrefix, lang });
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // The same URL is a different page the moment marketing edits the offer, and the
      // API's own 60s cache is the only staleness this route should carry.
      "Cache-Control": "no-store",
      [OFFER_STATE_HEADER]: "resolved",
      ...SEC,
    },
  });
}

// ── Lead forms ────────────────────────────────────────────────────────────────
// The O'Neill pages POST FormData to /xhr/<form>/ and expect
// {"data":{"content":"<thank-you html>"},"success":true} back (oilib injects
// data.content into the form's message div — see handle_valid_response in oilib.js).
// We forward every lead to HubSpot's public Forms Submission API on the portal the
// live site already uses for its embedded forms (<HUBSPOT_PORTAL_ID>), so leads land in the same
// CRM the marketing team works today. No auth needed for form submissions.
// ponytail: one generic form GUID for all lead sources; the source form + every
// unmapped field is preserved in the message body. Swap HS_FORM_GUID (wrangler var)
// for a dedicated "Website Contact" form when marketing creates one.
const HS_PORTAL = "<HUBSPOT_PORTAL_ID>";
const HS_FORM_GUID = "<HUBSPOT_FORM_GUID>"; // "Act Now" lead form (firstname/lastname/email/phone)

// /xhr/ endpoints that are real lead forms on the live site (POST-only; live returns
// 405 to GET). Everything else under /xhr/ (oicheck, recommend, filter/load-more) is
// a frozen-snapshot content XHR and keeps the benign stub below.
const LEAD_XHR = new Set([
  "contact", "realtor", "referral", "general", "osc", "footer-chat",
  "request-information", "tour", "general-tour", "coming-soon", "construction",
  "two-year-warranty", "ten-year-warranty", "dontmissoutform", "designprocess",
  "detail-promo", "list-promo",
  "location-specs-download", "location-plans-download", "specs-list-download",
]);

// Direct contact-property mappings; everything else rides along in the message body.
const FIELD_MAP = { first_name: "firstname", last_name: "lastname", email: "email" };
const SKIP_FIELDS = new Set(["oicheck", "oicaptcha", "ga4_client_id", "country_code", "primary_phone", "opt_in", "page_url"]);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function submitLead(request, env, formName) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ errors: { email: "Invalid form submission." } }, 400);
  }
  const get = (k) => (form.get(k) || "").toString().trim();
  const email = get("email");
  // Live returns 400 to unusable payloads; client-side validation requires email on
  // every lead form, so a missing email means a bot or a broken page — don't fake success.
  if (!email) return json({ errors: { email: "Email is required." } }, 400);

  const fields = [{ name: "email", value: email }];
  if (get("first_name")) fields.push({ name: "firstname", value: get("first_name") });
  if (get("last_name")) fields.push({ name: "lastname", value: get("last_name") });
  const phone = get("primary_phone");
  if (phone) fields.push({ name: "phone", value: (get("country_code") || "") + phone });

  // Preserve everything else (message, tour date/time, item of interest, warranty
  // details, realtor/referral fields, ...) in the message body so no lead data is lost.
  const lines = [];
  const msg = get("message");
  if (msg) lines.push(msg, "");
  lines.push(`[form] ${formName}`);
  for (const [k, v] of form.entries()) {
    const val = (v || "").toString().trim();
    if (!val || k in FIELD_MAP || SKIP_FIELDS.has(k) || k === "message" || k === "email") continue;
    lines.push(`[${k}] ${val}`);
  }
  if (get("opt_in")) lines.push("[opt_in] yes");
  fields.push({ name: "message", value: lines.join("\n") });

  const pageUri = get("page_url") || request.headers.get("referer") || LIVE;
  const submitUrl =
    (env.HS_SUBMIT_URL || "https://api.hsforms.com/submissions/v3/integration/submit") +
    `/${env.HS_PORTAL || HS_PORTAL}/${env.HS_FORM_GUID || HS_FORM_GUID}`;

  const resp = await fetch(submitUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields, context: { pageUri, pageName: formName } }),
  });

  if (!resp.ok) {
    console.error(`lead forward failed: ${formName} -> ${resp.status} ${await resp.text().catch(() => "")}`);
    return json({ errors: { email: "Something went wrong sending your message. Please try again or call 956-275-8069." } }, 502);
  }

  // Pages where oilib was replaced by islands submit natively (browser navigation,
  // Accept: text/html) — send them to /thankyou/ like the live site's conventional
  // form flow. AJAX (oilib) submits get the JSON contract oilib expects; it injects
  // data.content into the form's message div.
  if ((request.headers.get("accept") || "").includes("text/html")) {
    return new Response(null, { status: 303, headers: { Location: new URL("/thankyou/", request.url).toString() } });
  }
  const hs = await resp.json().catch(() => ({}));
  const thanks = hs.inlineMessage || "<p>Thank you! We've received your information and will be in touch soon.</p>";
  return json({ data: { content: thanks }, success: true });
}

// Real assets fail fast on 404; page misses serve our branded 404 page (a mangled asset
// URL must not fall through and pull down a full HTML page for every missing image).
const ASSET_RE = /\.(js|css|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|eot|map|mp4|json|xml|txt|pdf)$/i;

// Site-wide security headers. No CSP on purpose: the scrape carries many third-party
// pixels a policy would break (same decision as the old Caddyfile).
const SEC = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

// Sentry browser Loader Script. Injected as the FIRST <head> script on every HTML page so
// it buffers errors before the page's other (static-scrape) scripts run. Loader (not npm)
// because the frontend is static assets on a Worker — DSN + config live in the CDN bundle.
const SENTRY_LOADER =
  '<script src="https://js.sentry-cdn.com/<SENTRY_LOADER_KEY>.min.js" crossorigin="anonymous"></script>';

// A home URL with no baked page: /new-homes/tx/<city>/<community>/<slug>/ or
// /new-homes/available/<slug>/ — NOT community pages (3-deep) or the shell/grid itself.
// Bare (English) paths only; callers strip /es first.
function isUnbuiltHomePath(p) {
  return (
    (/^\/new-homes\/tx\/[^/]+\/[^/]+\/[^/]+\/?$/.test(p) || /^\/new-homes\/available\/[^/]+\/?$/.test(p)) &&
    p !== "/new-homes/available/home/" &&
    p !== "/new-homes/available/home"
  );
}

// The live detail shell, rendered by qmi-detail-live.js from the API. Never cached — the
// same URL is a different home's page the moment inventory changes.
function liveShell(shell) {
  const out = new Response(shell.body, shell);
  out.headers.set("Content-Type", "text/html; charset=utf-8");
  out.headers.set("Cache-Control", "no-store");
  for (const [k, v] of Object.entries(SEC)) out.headers.set(k, v);
  return out;
}

// One chokepoint: prepend the loader into <head> of every text/html response. Non-HTML
// (API JSON, assets, redirects) passes through untouched.
function withSentry(response) {
  if (!(response.headers.get("content-type") || "").includes("text/html")) return response;
  return new HTMLRewriter()
    .on("head", { element(el) { el.prepend(SENTRY_LOADER, { html: true }); } })
    .transform(response);
}

async function handle(request, env, esFallback = false) {
    const url = new URL(request.url);
    let p = url.pathname;

    // Spanish is served from committed /es/ twins baked by es-bake.mjs — no redirect, no
    // runtime translation. Paths without a twin fall back to English below (the 404 branch),
    // so a not-yet-rebaked page is a 200 in the wrong language, never a 404.

    // Cleartext http must 301 to https (live does; "Always Use HTTPS" isn't on for
    // this hostname). Sniff the visitor's real scheme from cf-visitor/x-forwarded-proto
    // when the edge request is already https. url.protocol stays "http:" under wrangler
    // dev, so local/Cursor preview subresources aren't caught in a 301 loop.
    const visitor = request.headers.get("cf-visitor") || "";
    const isCleartext =
      visitor.includes('"scheme":"http"') || request.headers.get("x-forwarded-proto") === "http";
    // url.protocol stays "http:" under wrangler dev (and Cursor's port-forward proxy
    // sends x-forwarded-proto: http on every subresource). Only upgrade when the edge
    // request itself is https — i.e. production behind Cloudflare.
    if (url.protocol !== "http:" && isCleartext) {
      url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }

    // Same-origin proxy to the public API so the browser avoids CORS (the API only
    // allows the esperanzahomes.com origin). Build a clean subrequest — forwarding the
    // incoming Host header bounces the request back to this Worker instead of the API.
    // Let the CF edge cache the JSON 60s.
    if (p.startsWith("/api/")) {
      const h = new Headers();
      const accept = request.headers.get("accept");
      if (accept) h.set("accept", accept);
      const ct = request.headers.get("content-type");
      if (ct) h.set("content-type", ct);
      h.set("origin", LIVE); // the API's allow-listed origin

      // Draft preview (STAGING ONLY), PER-HOME and EXPLICIT. env.PREVIEW_SECRET is bound
      // only on the staging Worker (never prod). The detail shell requests /api/preview/qmi
      // (with ?preview=1) to render ONE specific draft; we attach the secret server-side so
      // the API returns it. We deliberately do NOT rewrite the public list — /api/public/qmi
      // stays published-only, so the grid / community / homepage never flood with drafts.
      let previewing = false;
      if (env.PREVIEW_SECRET && p.startsWith("/api/preview/")) {
        h.set("X-Esperanza-Preview", env.PREVIEW_SECRET);
        previewing = true;
      }

      const sub = new Request(API + p + url.search, {
        method: request.method,
        headers: h,
        body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
        redirect: "manual",
      });
      // env.API is the deployed service binding. Under `wrangler dev` the binding is a
      // 503 stub (no local esperanza-api session); fall back to a plain fetch there —
      // the 1042 worker-to-worker block that motivated the binding only applies deployed.
      let resp = env.API ? await env.API.fetch(sub) : null;
      if (!resp || resp.status === 503) resp = await fetch(new Request(sub, { redirect: "manual" }));
      const out = new Response(resp.body, resp);
      // Never edge-cache draft previews (drafts change); cache the public JSON as before.
      out.headers.set("Cache-Control", previewing ? "no-store" : "public, s-maxage=60, max-age=30");
      return out;
    }

    // Staging preview: neutralize the HARVESTED live-facts badges + per-home cardFacts so
    // the dynamic cards (available-live.js) render the LIVE incentive/availability from the
    // API. The harvested map otherwise WINS over the API, hiding unpublished incentive
    // edits. Keep rate/taxMult/lotFormat (monthly calc + lot display). Gated by
    // env.PREVIEW_SECRET (staging only) — prod serves the file unchanged.
    if (env.PREVIEW_SECRET && p === "/live-facts.json") {
      const r = await env.ASSETS.fetch(new Request(new URL("/live-facts.json", request.url)));
      if (r.status === 200) {
        try {
          const f = await r.json();
          f.badges = {};
          f.cardFacts = {};
          return new Response(JSON.stringify(f), {
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch { /* fall through to the normal asset serve below */ }
      }
    }

    // Homefiniti analytics beacons — 204 so the client stops chasing a dead 302.
    if (p.startsWith("/hfa/")) return new Response("", { status: 204 });

    // oilib's gallery keyword search fetches /sitesearch.json?scope=tag (the live
    // server filters by scope; static assets ignore queries). Serve the harvested
    // tag index for that scope; the frozen default file already covers the header
    // search scopes (location,plan,spec,lot,blogpost).
    if (p === "/sitesearch.json" && (url.searchParams.get("scope") || "").startsWith("tag")) {
      return env.ASSETS.fetch(new Request(new URL("/sitesearch-tag.json", request.url)));
    }

    // Header search + oilib autocomplete: live D1 index from esperanza-api. Fall back
    // to the baked static snapshot when the API endpoint isn't deployed yet.
    if (p === "/sitesearch.json") {
      const h = new Headers();
      h.set("accept", "application/json");
      h.set("origin", LIVE);
      const sub = new Request(API + "/api/public/sitesearch.json" + url.search, {
        method: request.method,
        headers: h,
        redirect: "manual",
      });
      let resp = env.API ? await env.API.fetch(sub) : null;
      if (!resp || resp.status === 503) resp = await fetch(new Request(sub, { redirect: "manual" }));
      if (resp.ok) {
        const out = new Response(resp.body, resp);
        out.headers.set("Content-Type", "application/json");
        out.headers.set("Cache-Control", "public, s-maxage=60, max-age=30");
        for (const [k, v] of Object.entries(SEC)) out.headers.set(k, v);
        return out;
      }
      const baked = await env.ASSETS.fetch(new Request(new URL("/sitesearch.json", request.url)));
      if (baked.status === 200) {
        const out = new Response(baked.body, baked);
        out.headers.set("Cache-Control", "public, s-maxage=60, max-age=30");
        for (const [k, v] of Object.entries(SEC)) out.headers.set(k, v);
        return out;
      }
    }

    // Lead-form endpoints: forward the POST to HubSpot; match live's 405 on other
    // methods. Frozen-snapshot XHRs (oicheck, recommend, filter/load-more) keep the
    // benign stub so page JS resolves quietly.
    if (p.startsWith("/xhr/")) {
      const name = p.slice(5).replace(/\/+$/, "");
      if (LEAD_XHR.has(name)) {
        if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
        return submitLead(request, env, name);
      }
      return json({ data: { content: "" }, success: true });
    }

    // Live blog pagination is query-string based (?i=0&page=N); the scrape stores each
    // page as <path>/page-N/index.html. Map the query onto that directory when it exists.
    const page = url.searchParams.get("page");
    if (p.startsWith("/blog/") && page && +page >= 2) {
      const paged = await env.ASSETS.fetch(new Request(new URL(`${p}page-${+page}/`, request.url)));
      if (paged.status === 200) {
        const out = new Response(paged.body, paged);
        for (const [k, v] of Object.entries(SEC)) out.headers.set(k, v);
        out.headers.set("Cache-Control", "public, max-age=300");
        return out;
      }
    }

    // Promotion detail route. MUST come before REDIRECTS and before the static-asset
    // fetch: /incentives/offer/ is a committed page, so falling through would serve the
    // un-baked template shell as a contentless 200 for any id at all. The legacy
    // /incentives/<slug>/ aliases are also committed directories (frozen June-8 mirrors),
    // so they too have to be intercepted before ASSETS answers them.
    const offerBare = isEsPath(p) ? stripEsPrefix(p) : p;
    const offerEsPrefix = isEsPath(p) ? ES_PREFIX : "";
    const offer = await offerRouteResponse(request, env, {
      url, p, bare: offerBare, esPrefix: offerEsPrefix,
    });
    if (offer) return offer;

    // Legacy live-site URL shapes (long QMI ids, drifted floor-plan ids, /new-homes/tx/
    // city stubs, retired blog slugs) 301 onto the mirror page with the same content.
    // Data lives in redirects.mjs (generated by scripts/gen-redirects.mjs against the
    // live sitemap, plus a hand-curated section at the bottom).
    const slashed = p.endsWith("/") ? p : p + "/";
    const dest = REDIRECTS[p] || REDIRECTS[slashed];
    if (dest) return Response.redirect(url.origin + dest, 301);

    // Old D1 community slug carried literal parens; the tree (and live) use the clean form.
    if (p.includes("/retama-village-(55-)-at-bentsen-palm")) {
      return Response.redirect(url.origin + p.replace("retama-village-(55-)-at-bentsen-palm", "retama-village-55-at-bentsen-palm"), 301);
    }

    // Scraped nav hrefs are relative; on the one-dir-shallower CLEAN community paths
    // the Quick Move-Ins link resolves to /available/ (root-clamped) instead of
    // /new-homes/available/. One redirect fixes the header on every affected page.
    if (slashed.startsWith("/available/")) {
      return Response.redirect(url.origin + "/new-homes" + p + url.search, 301);
    }

    // Header/footer community links use relative hrefs that climb out of /new-homes/tx/
    // and land on /{city}/{community}/{id}/ (e.g. /mission/tanglewood-at-bentsen-palm/4106/).
    const navComm = p.match(/^\/(brownsville|corpus-christi|edinburg|harlingen|laredo|mcallen|mercedes|mission|san-juan|weslaco)\/([^/]+)\/(\d+)\/?$/);
    if (navComm) {
      return Response.redirect(url.origin + `/new-homes/tx/${navComm[1]}/${navComm[2]}/${navComm[3]}/` + url.search, 301);
    }

    // Live serves PDFs at extension-less URLs; the scrape stored them as named files.
    // Map the live shapes onto the stored assets (mirror pages link the filename form
    // directly, so this only matters for external/live-shape links).
    let req = request;
    if (slashed === "/new-homes/pdf/") {
      req = new Request(new URL("/new-homes/pdf/Communities.pdf", request.url), request);
    } else if (/^\/pdf-features\/.+\/$/.test(slashed) && p === slashed) {
      req = new Request(new URL(slashed + "Features List.pdf", request.url), request);
    } else if (slashed === "/floorplan-collections/pdf/") {
      // 86MB scraped PDF exceeds the 25MiB static-asset cap; the esperanza-pdf Worker
      // generates the same all-plans list from D1 (fresher data, same UX).
      return Response.redirect("https://esperanza-pdf.round-base-ed8c.workers.dev/pdf/list/all-plans", 302);
    }

    // Static assets. html_handling resolves pretty URLs (/contact -> /contact/index.html).
    const resp = await env.ASSETS.fetch(req);

    if (resp.status === 404) {
      // HTTrack stored versioned theme files as "name﹖v=hash.ext"; some scraped
      // templates (gallery) reference the real "name.ext?v=hash" URL. Map the query
      // form onto the stored filename before giving up.
      const v = url.searchParams.get("v");
      if (p.startsWith("/static/") && v && /\.\w+$/.test(p)) {
        const alt = p.replace(/\.(\w+)$/, (_, ext) => `﹖v=${encodeURIComponent(v)}.${ext}`);
        const r = await env.ASSETS.fetch(new Request(new URL(alt, request.url)));
        if (r.status === 200) {
          const out = new Response(r.body, r);
          for (const [k, val] of Object.entries(SEC)) out.headers.set(k, val);
          out.headers.set("Cache-Control", "public, max-age=31536000, immutable");
          return out;
        }
      }
      if (ASSET_RE.test(p)) return new Response("Not found", { status: 404 });

      // The live D1 sitesearch index links communities as bare "/new-homes/<slug>" —
      // no city, no numeric id — so every community result in the header search 404'd.
      // Resolve the city from the public communities API and 301 onto the canonical
      // /new-homes/tx/<city>/<slug>/ page (through REDIRECTS so the rich id-path pages
      // are reached in one hop). Only runs on a 404, so it can never shadow real pages.
      const bareComm = p.match(/^\/new-homes\/([^/]+?)\/?$/);
      if (bareComm && bareComm[1] !== "tx") {
        const clean = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        const want = clean(decodeURIComponent(bareComm[1]));
        try {
          const h = new Headers({ accept: "application/json", origin: LIVE });
          const sub = new Request(API + "/api/public/communities", { headers: h, redirect: "manual" });
          let r = env.API ? await env.API.fetch(sub) : null;
          if (!r || r.status === 503) r = await fetch(new Request(sub, { redirect: "manual" }), { cf: { cacheTtl: 300 } });
          if (r.ok) {
            const { communities = [] } = await r.json();
            const c = communities.find((c) => clean(c.slug || c.name) === want);
            if (c && c.town) {
              const target = `/new-homes/tx/${clean(c.town)}/${clean(c.slug || c.name)}/`;
              return Response.redirect(url.origin + (REDIRECTS[target] || target), 301);
            }
          }
        } catch { /* fall through to the 404 page */ }
      }

      // A /es/ URL with no baked twin. A stale canonical QMI gets the same verified
      // manifest redirect as English, localized to its Spanish community; a republished
      // or ambiguous home still reaches the live shell. Spanish is otherwise additive,
      // so new home URLs between rebuilds must not 404. `esFallback` caps recursion.
      if (isEsPath(p) && !esFallback) {
        const bare = stripEsPrefix(p);
        const canonicalQmi = bare.match(/^\/new-homes\/tx\/[^/]+\/[^/]+\/([^/]+)\/?$/);
        if (canonicalQmi) {
          const target = await staleQmiRedirectTarget(request, env, bare.endsWith("/") ? bare : bare + "/");
          if (target && (await qmiSlugIsPublished(canonicalQmi[1], env)) === false) {
            return Response.redirect(url.origin + toEsPath(target), 301);
          }
        }
        if (isUnbuiltHomePath(bare)) {
          const shell = await env.ASSETS.fetch(new Request(new URL(toEsPath("/new-homes/available/home/"), request.url)));
          if (shell.status === 200) return liveShell(shell);
        }
        const enUrl = new URL(bare, request.url);
        enUrl.search = url.search;
        return handle(new Request(enUrl, request), env, true);
      }

      // A static QMI page may have been pruned as unpublished. On a manifest hit, verify
      // the live payload first: republished or ambiguous homes reach the live shell below.
      const canonicalQmi = p.match(/^\/new-homes\/tx\/[^/]+\/[^/]+\/([^/]+)\/?$/);
      if (canonicalQmi) {
        const target = await staleQmiRedirectTarget(request, env, slashed);
        if (target && (await qmiSlugIsPublished(canonicalQmi[1], env)) === false) {
          return Response.redirect(url.origin + target, 301);
        }
      }

      // Un-built QMI home page (draft or newly-published — no static page baked). Serve
      // the LIVE detail shell so qmi-detail-live.js renders the home by slug from the API
      // (drafts included on staging via the preview passthrough). Keeps the canonical URL
      // and needs no rebuild.
      if (isUnbuiltHomePath(p)) {
        const shell = await env.ASSETS.fetch(new Request(new URL("/new-homes/available/home/", request.url)));
        if (shell.status === 200) return liveShell(shell);
      }

      // Serve our branded 404 page (1:1 with the legacy site) with a real 404 status.
      const nf = await env.ASSETS.fetch(new Request(new URL("/404.html", request.url)));
      const headers = new Headers(nf.status === 200 ? nf.headers : {});
      headers.set("Content-Type", "text/html; charset=utf-8");
      headers.set("Cache-Control", "public, max-age=300");
      for (const [k, v] of Object.entries(SEC)) headers.set(k, v);
      return new Response(nf.status === 200 ? nf.body : "Page not found", { status: 404, headers });
    }

    const ct = resp.headers.get("content-type") || "";
    if (resp.ok && ct.includes("text/html")) {
      let html = await resp.text();
      html = patchHtmlLocale(html, p);
      const needsPromo =
        !html.includes("promotions-live.js") &&
        (html.includes('class="alert-banner"') || html.includes('id="incentives"') || slashed.startsWith("/incentives/"));
      if (needsPromo) {
        const cfg = JSON.stringify({ API_BASE: "/api/public" });
        // incentive-live.js is RETIRED (was: trim a scraped /incentives/<slug>/ page's
        // #available grid to homes matching the promotion BY COPY). Every committed slug
        // under public/incentives/ is a LEGACY_ALIAS_PROMO_IDS entry, and offerRouteResponse
        // 301s those before this branch is ever reached, so the island could not run; the
        // homes grid now lives on the ID-backed offer page and is rendered by exact
        // promotion_id (offer-live.js). offer-worker-check.mjs asserts the alias-before-asset
        // ordering that makes this true, and build.mjs --check fails if a NON-alias slug
        // directory is ever committed here (which is the only way this page class returns).
        const tag = `\n<script>window.__ESPERANZA=Object.assign(window.__ESPERANZA||{},${cfg});</script>\n<script src="/promotions-live.js" defer></script>\n`;
        const i = html.lastIndexOf("</body>");
        html = i === -1 ? html + tag : html.slice(0, i) + tag + html.slice(i);
      }
      // /events/ (+ /es/ twin): the admin's Event Highlights section, rendered by an
      // island injected at the edge — the scraped page needs no rebake to gain the
      // surface, and zero published highlights leaves it visually unchanged.
      if ((slashed === "/events/" || slashed === "/es/events/") && !html.includes("events-highlights-live.js")) {
        const ecfg = JSON.stringify({ API_BASE: "/api/public" });
        const etag2 = `\n<script>window.__ESPERANZA=Object.assign(window.__ESPERANZA||{},${ecfg});</script>\n<script src="/events-highlights-live.js" defer></script>\n`;
        const j = html.lastIndexOf("</body>");
        html = j === -1 ? html + etag2 : html.slice(0, j) + etag2 + html.slice(j);
      }
      const out = new Response(html, resp);
      for (const [k, v] of Object.entries(SEC)) out.headers.set(k, v);
      out.headers.set("Cache-Control", "public, max-age=300");
      // Locale is in the URL only — no Set-Cookie, nothing for a shared cache to vary on.
      return out;
    }

    const out = new Response(resp.body, resp);
    for (const [k, v] of Object.entries(SEC)) out.headers.set(k, v);
    // Never stamp long-lived caching on a non-200 (ASSETS 307-normalizes the legacy
    // "﹖v=" URLs; an immutable-cached redirect poisons that URL for a whole POP).
    if (!resp.ok) {
      out.headers.set("Cache-Control", "no-store");
    } else if (p.startsWith("/static/")) {
      out.headers.set("Cache-Control", "public, max-age=31536000, immutable");
    }
    return out;
}

export default {
  async fetch(request, env) {
    return withSentry(await handle(request, env));
  },
};
