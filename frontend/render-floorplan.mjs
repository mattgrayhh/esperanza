// render-floorplan.mjs — full brand-wide floor-plan detail page (/floorplans/<slug>/).
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { esc, money, num, galleryHtml, tourHtml, idaproPlanHtml, formSlotHtml, qmiCardHtml, finalizePage, cardSurfaces, bannerHtml, promoCtaHtml, promoIdAttr } from './sections.mjs';
import { floorplanPath, communityPath } from './paths.mjs';

export function floorplanContent(fp) {
  const beds = fp.bedroomMin === fp.bedroomMax ? fp.bedroomMin : `${fp.bedroomMin}-${fp.bedroomMax}`;
  const baths = fp.bathroomMin === fp.bathroomMax ? fp.bathroomMin : `${fp.bathroomMin}-${fp.bathroomMax}`;
  const stats = [
    `<div class="item detail col-12 col-lg-6">${beds} Bed</div>`,
    fp.garage != null ? `<div class="item detail col-12 col-lg-6">${esc(fp.garage)} Car Garage</div>` : '',
    `<div class="item detail col-12 col-lg-6">${baths} Bath</div>`,
    fp.stories != null ? `<div class="item detail col-12 col-lg-6">${esc(fp.stories)} ${fp.stories == 1 ? 'Story' : 'Stories'}</div>` : '',
    fp.totalSqft != null ? `<div class="item detail col-12 col-lg-6">${num(fp.totalSqft)} Total Sq. Ft.</div>` : '',
    fp.livingSqft != null ? `<div class="item detail col-12 col-lg-6">${num(fp.livingSqft)} Living Sq. Ft.</div>` : '',
    fp.hersScore != null ? `<div class="item detail col-12 col-lg-6">HERS Score: ${esc(fp.hersScore)}</div>` : '',
  ].filter(Boolean).join('');
  const locs = (fp.communityList || []).map(c => {
    const price = fp.communityPrices[c.name];
    return `<div class="col-12 col-md-6 col-lg-4 mb-3"><div class="card oi-map-item border border-gray p-2"><a href="${communityPath(c)}"><div class="card-title mt-2">${esc(c.name)}</div></a><div class="card-location text-green">${esc(c.city)}, TX</div>${price ? `<div class="price-title">Homes From</div><div class="price">${money(price)}</div>` : ''}<a href="${communityPath(c)}" class="btn btn-green mt-2 d-inline-block">View Community</a></div></div>`;
  }).join('');
  const homes = (fp.homes || []).map(qmiCardHtml).join('');
  const locCount = (fp.communityList || []).length;
  // Plan caveat 1: floor-plan records carry a resolved promotion whose headline/CTA this
  // page never rendered. Identity is ungated; the copy surfaces are independent.
  const surf = cardSurfaces(fp);
  return [
    `<section class="header pagejump text-center bg-tan-white pb-2 py-lg-4"${promoIdAttr(surf)}><div class="container"><h1 class="bodoni text-gray fs-1 ls-sm">${esc(fp.name)}</h1>${fp.collection ? `<div class="text-brown">${esc(fp.collection)} Collection</div>` : ''}${locCount ? `<a href="#mp-locations" class="d-block text-brown">Available in ${locCount} Communit${locCount == 1 ? 'y' : 'ies'}</a>` : ''}${fp.startingPrice ? `<div class="overpass bold text-dark-green fs-4 mt-2">Starting at ${money(fp.startingPrice)}</div>` : ''}${bannerHtml('', surf)}${promoCtaHtml(surf)}</div></section>`,
    galleryHtml(fp.image ? [{ url: fp.image, alt: fp.name }] : [], fp.image, fp.name),
    `<section id="overview" class="pagejump pt-4 pt-lg-5 bg-tan-white reverse pb-4"><div class="container-lg pt-3"><div class="row mb-3"><div class="col-12 col-md-7">${fp.description ? `<div class="wysiwyg">${fp.description}</div>` : ''}<div class="mt-4">${fp.brochurePdfUrl ? `<a href="${esc(fp.brochurePdfUrl)}" target="_blank" rel="noopener" class="btn btn-green oi-brochure-download me-2 mb-2">Download Brochure</a>` : ''}<a href="#request-a-tour" class="btn btn-auto btn-learn mb-2">Request Information</a></div></div><div class="col-12 col-md-5 col-lg-4 offset-lg-1 mt-4"><div class="row stat-group border-gray py-2">${stats}</div></div></div></div></section>`,
    tourHtml(fp.virtualTourUrl),
    idaproPlanHtml(fp.floorPlanImage || fp.image, fp.name, fp.planViewerUrl),
    locs ? `<section id="mp-locations" class="pagejump py-4 py-lg-5"><div class="container"><h2 class="bodoni text-gray fs-3 mb-4">Available Locations</h2><div class="row oi-listings">${locs}</div></div></section>` : '',
    homes ? `<section id="specs" class="pagejump py-4 py-lg-5 bg-tan-white"><div class="container"><h2 class="bodoni text-gray fs-3 mb-4">Quick Move-Ins with this Plan</h2><div class="row oi-listings">${homes}</div></div></section>` : '',
    formSlotHtml('general', fp.name),
  ].filter(Boolean).join('\n');
}

export function renderFloorplan(fp, shell) {
  const head = {
    title: `The ${fp.name} New Home | Esperanza Homes`,
    description: `The ${fp.name} floor plan${fp.collection ? ` (${fp.collection} Collection)` : ''}${fp.startingPrice ? ` from ${money(fp.startingPrice)}` : ''}.`,
    canonical: floorplanPath(fp), image: fp.image, url: floorplanPath(fp),
  };
  return finalizePage(shell, {
    content: floorplanContent(fp), head,
    page: { type: 'floorplan', id: fp.id, communitySlug: '' },
    islands: ['detail-extras.js', ...(fp.homes?.length ? ['community-homes-live.js'] : [])],
  });
}

function demo() {
  const fp = { id: 'recF', name: 'Agave', slug: 'agave', collection: 'Homestead', startingPrice: 396990, communityPrices: { 'Aqualina at Tres Lagos': 451990 }, bedroomMin: 4, bedroomMax: 5, bathroomMin: 3, bathroomMax: 3, garage: 3, stories: 1, livingSqft: 2786, totalSqft: 3639, hersScore: 43, image: '/fp.jpg', description: 'Spacious home.', planViewerUrl: 'https://idapro.cloud/flr_pln/agave', virtualTourUrl: 'https://my.matterport.com/show/?m=x', brochurePdfUrl: 'https://pdf/agave',
    communityList: [{ id: 'c1', name: 'Aqualina at Tres Lagos', slug: 'aqualina-at-tres-lagos', city: 'Edinburg' }],
    homes: [{ id: 'h1', address: '1 A St', community: 'Aqualina at Tres Lagos', city: 'Edinburg', slug: '1-a-st', price: 451990, beds: 4, baths: 3, livingSqft: 2786, image: '/h.jpg', communityObj: null }] };
  const out = floorplanContent(fp);
  for (const id of ['id="overview"', 'id="virtualtour"', 'id="plans"', 'id="mp-locations"', 'id="specs"', 'id="request-a-tour"']) assert(out.includes(id), 'has ' + id);
  assert(out.includes('Starting at $396,990') && out.includes('HERS Score: 43') && out.includes('Aqualina at Tres Lagos') && out.includes('$451,990'), 'content');
  assert(!out.includes('<!--CONTENT-->') && !/undefined/.test(out), 'clean');

  // --- promotion surfaces on the FLOOR-PLAN header (plan caveat 1) ---------------------
  // data.mjs's normFloorplan dropped badge and CTA entirely, so a plan-targeted promotion
  // could not reach this page at all. Contract: identity ungated, headline and CTA
  // independently gated, an empty value emits nothing, page survives.
  const surfaces = s => [...s.matchAll(/data-promo-surface="([^"]+)"/g)].map(m => m[1]).sort();
  const P = { promotionId: 'recFP1', promo: 'Agave Plan Incentive', cardBadge: 'PLAN BADGE', promoCtaLabel: 'See Offer', promoCtaLink: '/incentives/offer/recFP1/', promoStyle: 'green' };
  const full = floorplanContent({ ...fp, ...P });
  assert(full.includes('data-promo-id="recFP1"'), 'floor-plan header stamps identity');
  assert(full.slice(0, full.indexOf('id="overview"')).includes('data-promo-surface="headline"'), 'headline renders in the header');
  assert(full.includes('status-banner overlay-promo mt-2 align-top green') && full.includes('data-live="promo"'), 'API style + live hook');
  assert(full.includes('href="/incentives/offer/recFP1/"') && full.includes('See Offer'), 'CTA label + link');
  const hdrOf = s => s.slice(0, s.indexOf('id="overview"'));
  const hlOff = floorplanContent({ ...fp, ...P, promo: '', cardBadge: '' });
  assert.deepEqual(surfaces(hdrOf(hlOff)), ['cta'], 'headline off leaves ONLY the CTA in the header');
  assert(hlOff.includes('data-promo-id="recFP1"') && !hlOff.includes('overlay-promo'), 'promotion_id survives headline off');
  const ctaOff = floorplanContent({ ...fp, ...P, promoCtaLabel: '', promoCtaLink: '' });
  assert.deepEqual(surfaces(hdrOf(ctaOff)), ['headline'], 'CTA off leaves ONLY the headline in the header');
  assert(ctaOff.includes('data-promo-id="recFP1"') && !ctaOff.includes('promo-cta'), 'promotion_id survives CTA off');
  const bare = floorplanContent({ ...fp, ...P, promo: '', cardBadge: '', promoCtaLabel: '', promoCtaLink: '' });
  assert(bare.includes('data-promo-id="recFP1"') && !hdrOf(bare).includes('data-promo-surface'),
    'all off: identity remains, no surface node remains');
  assert(bare.includes('Agave') && bare.includes('Starting at $396,990') && bare.includes('HERS Score: 43')
    && bare.includes('id="mp-locations"') && bare.includes('id="specs"'),
    'the header and page survive an all-off record');
  assert(!floorplanContent({ ...fp, ...P, promotionId: '' }).includes('data-promo-id'), 'no winner -> no identity attribute');
  assert(!out.includes('data-promo-id') && !out.includes('data-promo-surface') && !out.includes('overlay-promo'),
    'a promotion-free plan renders no promo markup at all');
  console.log('render-floorplan.mjs demo() passed');
}
if (process.argv.includes('--check') && process.argv[1] === fileURLToPath(import.meta.url)) demo();
