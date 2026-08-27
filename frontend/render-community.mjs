// render-community.mjs — full community detail page.
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { esc, money, galleryHtml, mapSalesHtml, formSlotHtml, qmiSectionHtml, planCardHtml, bannerHtml, finalizePage, cardSurfaces, promoCtaHtml, promoIdAttr } from './sections.mjs';
import { communityPath } from './paths.mjs';
import { slugify } from './data.mjs';

function communityHeader(c) {
  const citySlug = slugify(c.city);
  const priced = c.priceFrom > 0 && !c.comingSoon;
  const lines = [
    `<div class="d-block d-lg-inline-block">New Homes in <a href="/${citySlug}/" class="text-decoration-underline text-brown">${esc(c.city)}, TX</a></div>`,
  ];
  if (priced) {
    lines.push('<div class="d-none d-lg-inline-block mx-1">•</div>');
    lines.push(`<div class="d-block d-lg-inline-block">Starting at ${money(c.priceFrom)}</div>`);
  }
  if (c.address) lines.push(`<div>${esc(c.address)}</div>`);
  if (c.lat != null && c.lng != null) {
    lines.push(`<a href="https://maps.google.com/maps?q=${c.lat},${c.lng}" target="_blank" rel="noopener" class="btn btn-gray mt-2 oi-directions-click">GET DIRECTIONS</a>`);
  }
  // The community's resolved promotion: gated headline (bannerHtml, styled from the API's
  // own promo_banner_style rather than a hardcoded tan) and an independently gated CTA.
  // `promoIdAttr` is ungated identity, so a community with both copy surfaces toggled off
  // still declares which offer it won.
  const surf = cardSurfaces(c);
  return [
    `<section class="header text-center bg-tan-white pb-2 py-lg-4"${promoIdAttr(surf)}>`,
    '<div class="green-bar-thick mt-2 mt-lg-0 mb-1 mb-lg-3 mx-auto d-none d-lg-block"></div>',
    `<h1 class="bodoni text-gray fs-1 ls-sm">${esc(c.name)}</h1>`,
    `<div class="overpass text-brown fs-6 ls-sm px-1">${lines.join('\n')}</div>`,
    bannerHtml('', surf),
    promoCtaHtml(surf),
    '</section>',
  ].filter(Boolean).join('\n');
}

export function communityContent(c) {
  // Full community photo gallery from D1 (communities.photo_gallery_json → API photoGallery),
  // falling back to the hero + secondary image when a community has no gallery. The legacy
  // 2-image cap was the "galleries near-empty on our site" bug (parity audit 2026-07-21).
  const gallery = (Array.isArray(c.photoGallery) && c.photoGallery.length)
    ? c.photoGallery.map(g => ({ url: g.url || g, alt: g.alt || c.name }))
    : [c.image, c.secondaryImage].filter(Boolean).map(u => ({ url: u, alt: c.name }));
  const plans = (c.plans || []).map(fp => planCardHtml(fp, c.name)).join('');
  // HOA documents (CCRs, amendments) — {title, link} PDFs hosted in R2. Rendered as a
  // simple download list; omitted when the community has none.
  const hoaItems = (c.hoaLinks || [])
    .map((l) => `<li class="mb-2"><a href="${esc(l.link)}" target="_blank" rel="noopener" class="text-brown text-decoration-underline">${esc(l.title || 'Document')}</a></li>`)
    .join('');
  const hoa = hoaItems
    ? `<section id="hoa" class="pagejump py-4 py-lg-5 bg-tan-white"><div class="container"><h2 class="bodoni text-gray fs-3 mb-4">HOA Documents</h2><ul class="list-unstyled mb-0">${hoaItems}</ul></div></section>`
    : '';
  return [
    communityHeader(c),
    galleryHtml(gallery, c.image, c.name),
    `<section id="overview" class="pagejump pt-4 pt-lg-5 bg-tan-white reverse pb-4"><div class="container-lg pt-3"><div class="row mb-3"><div class="col-12 col-md-7">${c.description ? `<div class="wysiwyg">${c.description}</div>` : ''}</div><div class="col-12 col-md-5 col-lg-4 offset-lg-1 mt-4"><div class="stat-group border-gray py-2">${c.priceFrom ? `<div class="item detail col-12">Homes from <span class="text-dark-green">${money(c.priceFrom)}</span></div>` : ''}${c.beds ? `<div class="item detail col-12">${esc(c.beds)} Bedrooms</div>` : ''}${c.baths ? `<div class="item detail col-12">${esc(c.baths)} Bathrooms</div>` : ''}${c.sqft ? `<div class="item detail col-12">${esc(c.sqft)} Sq. Ft.</div>` : ''}</div>${c.amenities ? `<div class="mt-4"><h3 class="overpass bold fs-7">Community Amenities</h3><div id="amenities-list" class="wysiwyg">${c.amenities}</div></div>` : ''}</div></div></div></section>`,
    qmiSectionHtml(c.homes),
    plans ? `<section id="plans" class="pagejump py-4 py-lg-5 bg-tan-white"><div class="container"><h2 class="bodoni text-gray fs-3 mb-4">Available Floor Plans</h2><div class="row oi-listings oi-listings-plan">${plans}</div></div></section>` : '',
    hoa,
    mapSalesHtml(c),
    formSlotHtml('tour', c.name),
  ].filter(Boolean).join('\n');
}

export function renderCommunity(c, shell) {
  const head = {
    title: `${c.city}, TX New Homes | ${c.name} from Esperanza Homes`,
    description: `New homes in ${c.name}, ${c.city}, TX${c.priceFrom ? ` from ${money(c.priceFrom)}` : ''}.`,
    canonical: communityPath(c), image: c.image, url: communityPath(c),
  };
  return finalizePage(shell, { content: communityContent(c), head, page: { type: 'community', id: c.id, communitySlug: c.slug || '' }, islands: ['detail-extras.js', 'community-maps-live.js', 'community-homes-live.js', 'community-copy-live.js'] });
}

function demo() {
  const c = { id: 'recC', name: 'El Eden', slug: 'el-eden', city: 'Laredo', lat: 27.43, lng: -99.45, priceFrom: 209990, beds: '3 - 5', baths: '2 - 4', sqft: '1,148 - 2,328', description: '<p>Great</p>', amenities: '<ul><li>Pool</li></ul>', image: '/c.jpg', secondaryImage: '/c2.jpg',
    photoGallery: [{ url: '/g1.jpg', alt: 'a' }, { url: '/g2.jpg', alt: 'b' }, { url: '/g3.jpg', alt: 'c' }],
    homes: [{ id: 'h1', address: '1 A St', community: 'El Eden', city: 'Laredo', slug: '1-a-st', price: 236990, beds: 3, baths: 2, livingSqft: 1106, image: '/h.jpg', communityObj: null }],
    plans: [{ id: 'p1', name: 'Presidio', slug: 'presidio', collection: 'Haven', startingPrice: 219990, communityPrices: { 'El Eden': 229990 }, bedroomMin: 3, bedroomMax: 4, bathroomMin: 2, bathroomMax: 3, garage: 2, livingSqft: 1400, image: '/p.jpg' }] };
  const out = communityContent(c);
  for (const id of ['id="overview"', 'id="specs"', 'id="plans"', 'id="sales"', 'id="request-a-tour"']) assert(out.includes(id), 'has ' + id);
  assert(out.includes('Starting at $209,990') && out.includes('green-bar-thick') && out.includes('New Homes in') && out.includes('Pool') && out.includes('1 A St') && out.includes('Presidio'), 'content');
  // Plan card must show the per-community price ($229,990), NOT the dev-wide min ($219,990).
  assert(out.includes('$229,990') && !out.includes('$219,990'), 'plan card per-community price');
  // Full gallery (>2 images) surfaces from photoGallery, not just hero+secondary.
  assert(out.includes('/g1.jpg') && out.includes('/g2.jpg') && out.includes('/g3.jpg'), 'community gallery from photoGallery');
  assert(!out.includes('<!--CONTENT-->') && !/undefined/.test(out), 'clean');

  // --- promotion surfaces on the COMMUNITY header ------------------------------------
  // The community record already carried a resolved promotion that this page never
  // rendered. Contract: identity ungated, headline and CTA independently gated, an empty
  // value emits nothing while the header survives.
  const surfaces = s => [...s.matchAll(/data-promo-surface="([^"]+)"/g)].map(m => m[1]).sort();
  const P = { promotionId: 'recC1', promo: 'Los Prados Homebuyer Advantage', cardBadge: 'COMMUNITY BADGE', promoCtaLabel: 'See Offer', promoCtaLink: '/incentives/offer/recC1/', promoStyle: 'green' };
  const full = communityContent({ ...c, ...P });
  assert(full.includes('data-promo-id="recC1"'), 'community header stamps identity');
  assert.deepEqual(surfaces(full), ['cta', 'headline'], 'community header renders headline + CTA');
  assert(full.includes('status-banner overlay-promo mt-2 align-top green') && full.includes('data-live="promo"'),
    'headline uses the API style (not the old hardcoded tan) and keeps its live hook');
  assert(full.includes('href="/incentives/offer/recC1/"') && full.includes('See Offer'), 'CTA label + link');
  assert(!full.includes('COMMUNITY BADGE'), 'the corner badge is a card affordance, not a detail-header one');
  const hlOff = communityContent({ ...c, ...P, promo: '', cardBadge: '' });
  assert.deepEqual(surfaces(hlOff), ['cta'], 'headline off leaves ONLY the CTA');
  assert(hlOff.includes('data-promo-id="recC1"') && !hlOff.includes('overlay-promo'), 'promotion_id survives headline off');
  const ctaOff = communityContent({ ...c, ...P, promoCtaLabel: '', promoCtaLink: '' });
  assert.deepEqual(surfaces(ctaOff), ['headline'], 'CTA off leaves ONLY the headline');
  assert(ctaOff.includes('data-promo-id="recC1"') && !ctaOff.includes('promo-cta'), 'promotion_id survives CTA off');
  const bare = communityContent({ ...c, ...P, promo: '', cardBadge: '', promoCtaLabel: '', promoCtaLink: '' });
  assert(bare.includes('data-promo-id="recC1"') && !bare.includes('data-promo-surface'),
    'all off: identity remains, no surface node remains');
  assert(bare.includes('El Eden') && bare.includes('Starting at $209,990') && bare.includes('GET DIRECTIONS')
    && bare.includes('id="overview"') && bare.includes('id="specs"'),
    'the header and page survive an all-off record');
  assert(!communityContent({ ...c, ...P, promotionId: '' }).includes('data-promo-id'), 'no winner -> no identity attribute');
  // A community with no promotion at all must look exactly as it did before this pass.
  assert(!out.includes('data-promo-id') && !out.includes('data-promo-surface') && !out.includes('overlay-promo'),
    'a promotion-free community renders no promo markup at all');
  console.log('render-community.mjs demo() passed');
}
if (process.argv.includes('--check') && process.argv[1] === fileURLToPath(import.meta.url)) demo();
