// render-qmi.mjs — full QMI detail page from a normalized home + the chrome shell.
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { esc, money, num, statItem, ICON, descHtml, descWantsUl, galleryHtml, mobileGalleryBarHtml, subnavHtml, selfTourCalloutHtml, tourHtml, elevationHtml, idaproPlanHtml, energyHtml, communityBlurbHtml, mapSalesHtml, formSlotHtml, recommendedHtml, mortgageCalcModalHtml, setHead, finalizePage, fmtLot, factOf, promoBannerClass, taxMultFor, getBuildRate, cardSurfaces, promoCtaHtml, promoHeadlineHtml, promoIdAttr } from './sections.mjs';
import { isRatePromo } from './promo-utils.mjs';
import { qmiPath, communityPath, floorplanPath } from './paths.mjs';
import { slugify } from './data.mjs';

const GREEN_ARROW = '/static/esperanza_homes/images/green-arrow%EF%B9%96v=a02d15d.svg';

export function qmiContent(h) {
  const c = h.communityObj || {};
  // Elevations = the home's own elevation render (same art as the hero), per original.
  const has = { tour: !!h.virtualTourUrl, plans: !!(h.planViewerUrl || h.planImage), elev: !!h.image, comm: !!(c.description || c.image), sales: !!(c.lat && c.lng) };

  // --- Header (1:1 O'Neill; left-align relies on body.spec-detail, present in shell) ---
  const fpHref = floorplanPath(h.floorplanObj || { name: h.floorPlan });
  const commHref = communityPath(c.slug ? c : { name: h.community, city: h.city });
  const fpLink = h.floorPlan ? `<div class="d-block text-brown"><a href="${esc(fpHref)}" class="text-brown">${esc(h.floorPlan)} Floor Plan</a></div>` : '';
  const commLink = h.community ? `<div class="d-block"><a href="${esc(commHref)}" class="text-brown">${esc(h.community)}${h.city ? ` in ${esc(h.city)}, TX` : ''}</a></div>` : '';
  const avail = h.availability ? `<div class="status-banner gray mt-2 align-top" data-live="availability">${esc(h.availability)}</div>` : '';
  // Live, not baked: hydrate-live.js refreshes text + color from promo_banner_style.
  // Gated surfaces: the detail header carries the headline and (independently) the CTA;
  // the corner badge is a card affordance and has no place in this layout.
  const surf = cardSurfaces(h);
  const promoText = surf.headline;
  const promoB = promoHeadlineHtml(surf, { kind: 'detail' });
  const promoCta = promoCtaHtml(surf);
  // Identity, ungated: present whenever the home won an offer, even with every copy
  // surface off, so the detail page can be probed for WHICH promotion applies.
  const pidAttr = promoIdAttr(surf);
  const saving = isRatePromo(promoText, getBuildRate())
    ? `<p id="calculator-promo-saving" class="small mb-2"></p>` : '';
  // Bake price + per-community tax so the calculator (detail-extras.js) computes the
  // monthly AND "Savings Over 30 Years" LIVE from the Settings rates (mortgage + incentive)
  // — not the frozen June harvest. data-live="price" already carries the price.
  const tax = taxMultFor(h);
  // `data-promo-slot` marks WHERE each surface belongs, independently of whether one is
  // rendered right now. hydrate-live.js needs an anchor to INSERT into: a page baked while
  // a toggle was off has no node to refresh, and without a slot the island would have to
  // guess at a location from theme classes. The slots are inert markers — they carry no
  // copy, so they say nothing about entitlement and are safe on a promotion-free page.
  const header = `<section class="header text-center bg-tan-white pb-2 py-lg-4" data-promo-slot="header"${pidAttr}><div class="container"><div class="row align-items-center"><div class="col-12 col-md-9" data-promo-slot="headline"><div class="green-bar-thick mt-2 mt-lg-0 mb-1 mb-lg-3 me-auto d-none d-lg-block"></div><h1 class="bodoni text-gray fs-1 ls-sm">${esc(h.address)}</h1>${fpLink}${commLink}${avail}${promoB}</div><div class="col-12 col-md-3" data-promo-slot="cta"><div><div class="overpass fs-7">PRICED AT</div><div class="overpass bold text-dark-green fs-4" data-live="price">${money(h.price)}</div></div>${saving}${promoCta}<div><a data-bs-toggle="modal" data-bs-target="#payment-calculator" data-tax="${tax}"><div class="btn btn-auto btn-learn">Calculate Monthly Payment<img class="ms-auto mb-1" src="${GREEN_ARROW}" aria-hidden="true" loading="lazy" width="16"></div></a></div></div></div></div></section>`;

  // --- Overview: description | stat-group + share + osc-callout; CTA row spans below ---
  const stats = [
    h.beds != null && statItem(ICON.bed, esc(h.beds) + ' Bed'),
    // live omits the garage row entirely when garage is 0 (same rule as qmiCardHtml)
    h.garage != null && String(h.garage) !== '0' && statItem(ICON.garage, esc(h.garage) + ' Car Garage'),
    h.baths != null && statItem(ICON.bath, Number(h.baths).toFixed(1) + ' Bath'),
    h.stories != null && statItem(ICON.story, esc(h.stories) + (h.stories == 1 ? ' Story' : ' Stories')),
    h.totalSqft != null && statItem(ICON.total, num(h.totalSqft) + ' Total Sq. Ft.'),
    // O'Neill's overview reuses the plain sqft icon for the Living row too.
    h.livingSqft != null && statItem(ICON.total, num(h.livingSqft) + ' Living Sq. Ft.'),
    h.lot != null && statItem(ICON.lot, 'Lot #' + esc(fmtLot(h.lot, h.community) || h.lot)),
  ].filter(Boolean).join('');
  const subj = encodeURIComponent(h.address || ''), shareUrl = qmiPath(h);
  const share = `<div class="share-buttons mb-3"><ul><li class="h6 title-underline">Share</li><li><a href="mailto:?subject=${subj}&body=${esc(shareUrl)}" target="_blank"><i class="far fa-envelope text-brown me-2 fa-lg"></i></a></li><li><a target="_blank" href="https://www.facebook.com/sharer/sharer.php?u=${esc(shareUrl)}&src=sdkpreparse" class="fb-xfbml-parse-ignore"><i class="fab fa-facebook text-brown me-1 fa-lg"></i></a></li><li><a href="https://twitter.com/intent/tweet?text=${subj}&url=${esc(shareUrl)}" target="_blank"><i class="fab fa-twitter text-brown fa-lg"></i></a></li></ul></div>`;
  const osc = `<div class="my-3 my-lg-4"><div class="osc-callout py-3 px-2 px-lg-3 text-center"><p class="bodoni text-white fs-4 ls-sm lh-2 fw-bold">Learn More About<br>${esc(h.address)}</p><button class="btn mb-2" data-bs-toggle="modal" data-bs-target="#osc-form">Get Answers</button></div></div>`;
  const dLat = h.lat != null ? h.lat : c.lat, dLng = h.lng != null ? h.lng : c.lng;
  const ctas = [
    h.pdfUrl && `<a class="btn btn-primary small-btn px-3 light-opacity mt-2 mt-lg-4 me-lg-2 oi-brochure-download" href="${esc(h.pdfUrl)}" target="_blank">DOWNLOAD BROCHURE</a>`,
    `<a href="#request-a-tour" class="btn btn-primary small-btn px-3 light-opacity mt-2 mt-lg-4 me-lg-2">SCHEDULE AN EXPLORATORY VISIT</a>`,
    `<a href="https://www.houseloan.com/" target="_blank" rel="noopener" class="btn btn-primary small-btn px-3 light-opacity mt-2 mt-lg-4 me-lg-2">GET PREQUALIFIED</a>`,
    (dLat && dLng) && `<a href="https://maps.google.com/maps?q=${dLat},${dLng}" target="_blank" rel="noopener" class="btn btn-primary small-btn px-3 light-opacity mt-2 mt-lg-4 me-lg-2 oi-directions-click">GET DIRECTIONS</a>`,
  ].filter(Boolean).join('');
  const overview = `<section id="overview" class="pt-4 pt-lg-5 bg-tan-white reverse pagejump pb-4"><div class="container-lg pt-3"><div class="row mb-3"><div class="col-12 col-md-7">${descHtml(h.description, descWantsUl(h.slug))}</div><div class="col-12 col-md-5 col-lg-4 offset-lg-1 mt-4 mt-md-2 mt-lg-3"><div class="row stat-group mt-4 py-2">${stats}</div>${share}${osc}</div></div><div class="row"><div class="col-12">${ctas}</div></div></div></section>`;

  // live drops the Photo Gallery anchor (and the whole gallery affordance) when the
  // home has <2 photos — see galleryHtml.
  const hasPhotos = h.gallery.length >= 2;
  const anchors = [['overview', 'Overview'], has.tour && ['virtualtour', 'Virtual Tour'], has.elev && ['elevations', 'Elevations'], has.plans && ['plans', 'Floor Plans'], hasPhotos && ['photos', 'Photo Gallery'], has.comm && ['community', 'Community'], has.sales && ['sales', 'Contact']].filter(Boolean);

  // Recommended For You = other floor plans offered in this home's community
  // (excluding its own plan); fall back to same-collection plans from the plan's
  // other communities. Cap 4 like the original's /xhr/recommend/ (l=4).
  const fpSlug = (h.floorplanObj && h.floorplanObj.slug) || slugify(h.floorPlan);
  let recPlans = (c.plans || []).filter(fp => fp.id !== h.floorPlanId);
  if (!recPlans.length && h.floorplanObj && h.floorplanObj.collection) {
    const seen = new Set([h.floorPlanId]);
    recPlans = (h.floorplanObj.communityList || []).flatMap(c2 => c2.plans || [])
      .filter(fp => fp.collection === h.floorplanObj.collection && !seen.has(fp.id) && seen.add(fp.id));
  }

  // Schedule-form thumbnail: an interior photo (2nd+ gallery image), not the
  // sales-office exterior.
  const interior = (h.gallery[1] && h.gallery[1].url) || (h.gallery[0] && h.gallery[0].url) || c.image;
  const selfTour = h.selfTourAvailable && h.nterNow ? selfTourCalloutHtml(h.nterNow) : '';

  return [
    header,
    galleryHtml(h.gallery, h.image, h.address),
    subnavHtml(anchors),
    mobileGalleryBarHtml(hasPhotos),
    selfTour,
    overview,
    has.tour && tourHtml(h.virtualTourUrl, h),
    has.elev && elevationHtml(h.elevation, h.image),
    has.plans && idaproPlanHtml(h.planImage, h.floorPlan, h.planViewerUrl),
    energyHtml({ planSlug: fpSlug, hers: h.hersScore }),
    has.comm && communityBlurbHtml(c),
    // Original order: Sales Office -> Schedule An Exploratory Visit -> Recommended.
    has.sales && mapSalesHtml({ ...c, zip: c.zip || h.postalCode }),
    formSlotHtml('tour', { address: h.address, image: interior }),
    recommendedHtml(recPlans, c.name),
    mortgageCalcModalHtml(h),
  ].filter(Boolean).join('\n');
}

export function renderQmi(h, shell) {
  const head = {
    // live pattern: "10341 N 15th Street, McAllen, TX New Home for Sale | Esperanza Homes"
    title: `${h.address}, ${h.city ? h.city + ', ' : ''}TX New Home for Sale | Esperanza Homes`,
    description: `${h.floorPlan || ''} home for sale in ${h.community}, ${h.city}, TX — ${money(h.price)}.`.trim(),
    canonical: qmiPath(h), image: (h.gallery[0] && h.gallery[0].url) || h.image, url: qmiPath(h),
  };
  return finalizePage(shell, { content: qmiContent(h), head, page: { type: 'qmi', id: h.id, communitySlug: (h.communityObj && h.communityObj.slug) || '' }, islands: ['hydrate-live.js', 'detail-extras.js', 'community-maps-live.js'] });
}

function demo() {
  const otherPlan = { id: 'fp2', name: 'San Luis', slug: 'san-luis', collection: 'Haven', startingPrice: 219990, communityPrices: { 'El Eden': 229990 }, bedroomMin: 3, bedroomMax: 3, bathroomMin: 2, bathroomMax: 2, garage: 2, stories: 1, livingSqft: 1443, totalSqft: 1887, image: '/sl.jpg', virtualTourUrl: 'https://my.matterport.com/y' };
  const c = { id: 'recC', name: 'El Eden', slug: 'el-eden', city: 'Laredo', lat: 27.43, lng: -99.45, description: '<p>Nice</p>', image: '/c.jpg', officePhone: '956-395-1516', officeHours: 'Mon-Sat 9-6', address: '104 Hidden Path Dr', plans: [otherPlan, { id: 'fp1' }] };
  const h = { id: 'recH', address: '5131 Carambola Ln', community: 'El Eden', city: 'Laredo', postalCode: '78046', slug: '5131-carambola-ln', floorPlan: 'Presidio', floorPlanId: 'fp1', floorplanObj: { id: 'fp1', name: 'Presidio', slug: 'presidio' }, price: 236990, beds: 3, baths: 2, garage: 2, stories: 2, lot: '334', hersScore: 47, livingSqft: 1106, totalSqft: 1471, description: 'Highlights:\n- Big yard', gallery: [{ url: '/1.jpg', alt: '' }, { url: '/2.jpg', alt: '' }, { url: '/3.jpg', alt: '' }], image: '/render.jpg', virtualTourUrl: 'https://my.matterport.com/show/?m=x', planViewerUrl: 'https://idapro.cloud/flr_pln/presidio', fpImage: '/fp.jpg', elevation: 'Presidio - Tuscan', pdfUrl: 'https://pdf/x', availability: 'Available Now', promo: '', communityObj: c };
  const out = qmiContent(h);
  for (const id of ['id="detail-gallery"', 'id="overview"', 'id="virtualtour"', 'id="elevations"', 'id="plans"', 'id="energy_cost"', 'id="community"', 'id="sales"', 'id="request-a-tour"', 'id="recommend"']) assert(out.includes(id), 'has ' + id);
  assert(out.includes('data-live="price"') && out.includes('$236,990'), 'price');
  assert(out.includes('Lot #334'), 'lot number stat');
  assert(out.includes('2 Stories'), 'stories stat');
  assert(out.includes('Floor Plans') && out.includes('SCHEDULE AN EXPLORATORY VISIT'), 'subnav label + overview CTA');
  assert(out.includes('<p>- Big yard</p>') && !out.includes('<li>Big yard</li>'), 'desc hyphen paragraphs');
  assert(out.includes('matterport.com') && out.includes('idapro.cloud'), 'tour+plan');
  // Gallery mosaic: render leads, side thumbs from the gallery, N = gallery size,
  // mobile full-width bar under the Go To... dropdown.
  assert(out.indexOf('/render.jpg') < out.indexOf('/1.jpg') && out.includes('View 3 Photos'), 'hero render + photo count');
  assert(out.indexOf('Go To...') < out.indexOf('View Photo Gallery') && out.indexOf('View Photo Gallery') < out.indexOf('id="overview"'), 'mobile gallery bar placement');
  // Elevations reuse the home render, no dark label chip.
  const elevSec = out.slice(out.indexOf('id="elevations"'), out.indexOf('id="plans"'));
  assert(elevSec.includes('/render.jpg') && !elevSec.includes('banner dark-green'), 'elevation render, no chip');
  // Energy Cost Comparison from the harvested per-plan map (presidio), explicit HERS wins.
  assert(out.includes('Energy Cost Comparison') && out.includes('>47<') && out.includes('id="numslider"'), 'energy section + HERS');
  assert(!qmiContent({ ...h, floorPlan: 'No Such Plan', floorplanObj: null, hersScore: null }).includes('id="energy_cost"'), 'energy omitted without data');
  // Original order: Sales Office -> Schedule form -> Recommended For You (last).
  assert(out.indexOf('id="sales"') < out.indexOf('id="request-a-tour"') && out.indexOf('id="request-a-tour"') < out.indexOf('Recommended For You'), 'section order');
  // Sales office address carries the ZIP (from the home when the community has none).
  assert(out.includes('Laredo, TX 78046'), 'sales office zip');
  // Recommended = other community plans as a swiper of plan-cards (own plan excluded).
  assert(out.includes('card plan-card') && out.includes('San Luis') && out.includes('$229,990') && out.includes('View Details') && out.includes('tour-icon'), 'recommended plan carousel');
  assert(!out.slice(out.indexOf('id="recommend"')).includes('Presidio</span>'), 'own plan excluded from carousel');
  // Schedule-form thumbnail = interior photo (2nd gallery image), not the sales office.
  const formSec = out.slice(out.indexOf('id="request-a-tour"'));
  assert(formSec.includes('/2.jpg') && !formSec.includes('/c.jpg'), 'form interior thumbnail');
  assert(out.includes('id="payment-calculator"') && out.includes('class="oi-calc"') && out.includes('OiCalc.Mortgage'), 'mortgage calc modal');
  assert(!out.includes('<!--CONTENT-->') && !/undefined|NaN/.test(out), 'no leftover markers/undefined/NaN');
  // garage 0 -> overview spec row omitted (live rule); 1-photo home -> no gallery affordance
  const g0 = qmiContent({ ...h, garage: 0 });
  assert(!g0.slice(g0.indexOf('id="overview"'), g0.indexOf('id="virtualtour"')).includes('Car Garage'), 'garage 0 omitted');
  const one = qmiContent({ ...h, gallery: [{ url: '/1.jpg', alt: '' }] });
  assert(!one.includes('Photo Gallery') && !one.includes('data-fancybox="photos"') && !one.includes('View Photo Gallery'), '1-photo home hides gallery + anchor');
  const st = qmiContent({ ...h, selfTourAvailable: true, nterNow: 'https://www.webflow.nternow.com/EsperanzaHomes/property/50036' });
  assert(st.includes('id="self-tour-callout"') && st.includes('Tour This Home Today') && st.includes('property/50036'), 'self-tour callout');
  assert(st.indexOf('id="self-tour-callout"') < st.indexOf('id="overview"'), 'self-tour before overview');
  assert(!qmiContent(h).includes('id="self-tour-callout"'), 'no self-tour without flags');
  const page = renderQmi(h, '<head><title>x</title></head><body><!--CONTENT--></body>');
  assert(page.includes('hydrate-live.js') && page.includes('community-maps-live.js') && page.includes('__ESPERANZA_PAGE'), 'islands+config');
  assert(page.includes('<title>5131 Carambola Ln, Laredo, TX New Home for Sale | Esperanza Homes</title>'), 'live-format SEO title');

  // --- promotion surfaces on the QMI DETAIL header ----------------------------------
  // Same contract as the cards (sections.surfaceContractDemo), asserted on this page's own
  // markup: identity ungated, headline and CTA independently gated, an empty value emits
  // nothing while the header itself survives. The corner badge is a card affordance and
  // deliberately has no place in this layout.
  const surfaces = s => [...s.matchAll(/data-promo-surface="([^"]+)"/g)].map(m => m[1]).sort();
  const P = { promotionId: 'recP1', promo: 'Unlock Your $15K Flex Discount Now!', cardBadge: 'CORNER BADGE', promoCtaLabel: 'See Offer Details', promoCtaLink: '/incentives/offer/recP1/', promoStyle: 'gold' };
  const full = qmiContent({ ...h, ...P });
  assert(full.includes('data-promo-id="recP1"'), 'detail header stamps identity');
  assert.deepEqual(surfaces(full), ['cta', 'headline'], 'detail header renders headline + CTA');
  assert(full.includes('status-banner overlay-promo mt-2 align-top tan') && full.includes('data-live="promo"'), 'headline keeps its hydrate hook + API color');
  assert(!full.includes('CORNER BADGE'), 'the corner badge is a card affordance, not a detail-header one');
  // Independent toggles: each removes only its own node, and identity survives both.
  const hlOff = qmiContent({ ...h, ...P, promo: '', cardBadge: '' });
  assert.deepEqual(surfaces(hlOff), ['cta'], 'headline off leaves ONLY the CTA');
  assert(hlOff.includes('data-promo-id="recP1"') && !hlOff.includes('overlay-promo'), 'promotion_id survives headline off; no ribbon');
  const ctaOff = qmiContent({ ...h, ...P, promoCtaLabel: '', promoCtaLink: '' });
  assert.deepEqual(surfaces(ctaOff), ['headline'], 'CTA off leaves ONLY the headline');
  assert(ctaOff.includes('data-promo-id="recP1"') && !ctaOff.includes('promo-cta'), 'promotion_id survives CTA off; no anchor');
  // Every surface off: identity remains, and nothing else about the page degrades.
  const bare = qmiContent({ ...h, ...P, promo: '', cardBadge: '', promoCtaLabel: '', promoCtaLink: '' });
  assert(bare.includes('data-promo-id="recP1"'), 'IDENTITY IS NOT A SURFACE on the detail header either');
  assert(!bare.includes('data-promo-surface'), 'no surface node, empty or otherwise, survives an all-off record');
  assert(bare.includes('5131 Carambola Ln') && bare.includes('$236,990') && bare.includes('Available Now')
    && bare.includes('Calculate Monthly Payment') && bare.includes('id="overview"'),
    'the header and page survive an all-off record (address, price, availability, calc CTA, sections)');
  assert(!qmiContent({ ...h, ...P, promotionId: '' }).includes('data-promo-id'), 'no winner -> no identity attribute');
  // The rate-promo savings line is driven by the HEADLINE, so it must vanish with it.
  const rate = qmiContent({ ...h, ...P, promo: '4.99% 30 Year Fixed Rate*', promoStyle: 'green' });
  assert(rate.includes('id="calculator-promo-saving"') && !hlOff.includes('id="calculator-promo-saving"'),
    'rate savings line follows the gated headline');
  // The slots hydrate-live.js inserts into. They must exist even with NO promotion, because
  // that is exactly the page that gains a surface later; without them the island has no
  // honest anchor and silently no-ops. Asserted here so the renderer owns its half of the
  // contract rather than relying on the island's fixture to notice.
  for (const [label, s] of [['with a promotion', full], ['with no promotion at all', out]]) {
    for (const slot of ['header', 'headline', 'cta']) {
      assert(s.includes(`data-promo-slot="${slot}"`), `${slot} slot baked ${label}`);
      assert((s.match(new RegExp(`data-promo-slot="${slot}"`, 'g')) || []).length === 1, `exactly one ${slot} slot ${label}`);
    }
  }
  assert(!out.includes('data-promo-id') && !out.includes('data-promo-surface') && !out.includes('overlay-promo'),
    'the slots carry no copy: a promotion-free page still renders no promo content');
  console.log('render-qmi.mjs demo() passed');
}
if (process.argv.includes('--check') && process.argv[1] === fileURLToPath(import.meta.url)) demo();
