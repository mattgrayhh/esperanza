/* detail-extras.js — client glue for generated detail pages: Fancybox gallery,
 * monthly-payment calculator (rate from /settings), and a no-lib zoom fallback for
 * the inline floor-plan viewer. The pure math is node-testable via
 * `node islands/detail-extras.js --check`. */
function monthlyPayment(price, opts) {
  opts = opts || {};
  var down = opts.down != null ? opts.down : 0.035;
  var rate = (opts.rate != null ? opts.rate : 6.2) / 100 / 12;
  var n = (opts.term != null ? opts.term : 30) * 12;
  var taxMult = opts.taxMult != null ? opts.taxMult : 2.2; // per-community property-tax %
  var principal = price * (1 - down);
  var pi = rate ? principal * rate / (1 - Math.pow(1 + rate, -n)) : principal / n;
  var tax = price * (taxMult / 100) / 12;
  var ins = price * 0.004 / 12;
  var pmi = down < 0.2 ? principal * 0.0075 / 12 : 0;
  return Math.round(pi + tax + ins + pmi);
}
// P&I only — the basis for "Savings Over 30 Years" (tax/ins/PMI are identical at either
// rate and cancel out).
function principalInterest(price, ratePct) {
  var loan = price * (1 - 0.035);
  var r = ratePct / 100 / 12;
  return r ? loan * r / (1 - Math.pow(1 + r, -360)) : loan / 360;
}

// Floor-plan viewer zoom clamp (fallback viewer scales 1x-3x).
function clampZoom(z) { return Math.min(3, Math.max(1, z)); }

if (typeof window === 'undefined') {
  // ponytail: this file also ships as a plain (non-module) browser <script>, so it
  // can't use `import`/`import.meta` at top level (SyntaxError outside a module) —
  // a throwing local check gives the same real-failure/non-zero-exit behavior as
  // node:assert without adding module syntax. Never imported by another .mjs module,
  // so there's no --check import cascade to guard against here (unlike the other demos).
  if (process.argv.includes('--check')) {
    var check = function (cond, msg) { if (!cond) throw new Error(msg); };
    var m = monthlyPayment(300000, { rate: 6.15 });
    check(m > 2200 && m < 2900, 'monthlyPayment ~2600, got ' + m);
    check(monthlyPayment(0) === 0, 'zero price -> zero (no phantom HOA), got ' + monthlyPayment(0));
    check(clampZoom(0.5) === 1 && clampZoom(2) === 2 && clampZoom(9) === 3, 'clampZoom 1..3');
    console.log('detail-extras.js demo() passed: $' + m + '/mo on $300k @6.15%');
  }
} else {
  (function () {
    'use strict';
    var CFG = window.__ESPERANZA || {}, API = CFG.API_BASE || '/api/public';
    // API fetch with a timeout so a hung API rejects (into the .catch, default rate stays).
    var fetchT = function (u, ms) { return fetch(u, AbortSignal.timeout ? { signal: AbortSignal.timeout(ms || 10000) } : {}); };
    var money = function (n) { return '$' + Number(n || 0).toLocaleString('en-US'); };

    if (window.Fancybox) window.Fancybox.bind('[data-fancybox]');

    // Floor-plan viewer fallback: the generated #plans section ships the original's
    // jQuery-iviewer markup + inline init; when the iviewer plugin isn't available
    // (vendor script missing/failed), wire #in/#out/#fit to a plain CSS-transform
    // zoom (clamped 1x-3x) on the plan drawing instead, so the controls always work.
    var viewer = document.getElementById('viewer');
    if (viewer && !(window.jQuery && window.jQuery.fn && window.jQuery.fn.iviewer)) {
      var planImg = document.querySelector('.plan-img-1 img');
      if (planImg && !viewer.querySelector('img')) {
        var vimg = document.createElement('img');
        vimg.src = planImg.getAttribute('src');
        vimg.alt = planImg.getAttribute('alt') || '';
        vimg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;transform-origin:center center;transition:transform .15s';
        viewer.appendChild(vimg);
        var zoom = 1;
        var apply = function () { vimg.style.transform = 'scale(' + zoom + ')'; };
        var on = function (id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('click', function (e) { e.preventDefault(); fn(); apply(); }); };
        on('in', function () { zoom = clampZoom(zoom + 0.5); });
        on('out', function () { zoom = clampZoom(zoom - 0.5); });
        on('fit', function () { zoom = 1; });
      }
    }

    // render-qmi's hero links to data-bs-target="#payment-calculator", but the shell
    // template has no such modal (it's only in the legacy static scrape, as a full
    // jQuery oicalc widget). Inject a minimal one so the trigger has somewhere to go
    // when the page lacks the full OiCalc modal (e.g. floor-plan pages).
    var calcTrigger = document.querySelector('[data-bs-target="#payment-calculator"]');
    if (calcTrigger && !document.getElementById('payment-calculator') && !document.querySelector('.oi-calc')) {
      var wrap = document.createElement('div');
      wrap.innerHTML = '<div class="modal fade rounded" id="payment-calculator" tabindex="-1" aria-labelledby="payment-calculator-label" aria-hidden="true">' +
        '<div class="modal-dialog modal-dialog-centered modal-lg"><div class="modal-content">' +
        '<button type="button" class="btn-close fs-6 ms-auto me-2 mt-2" data-bs-dismiss="modal" aria-label="Close"></button>' +
        '<div class="modal-header py-0"><div class="col text-center">' +
        '<div class="fs-4 bodoni ls-sm" id="payment-calculator-label">Calculate Monthly Payment</div>' +
        '<div class="green-bar-light my-2 my-lg-3 mx-auto"></div></div></div>' +
        '<div class="modal-body"><div class="row"><div class="col-11 col-lg-8 mx-auto text-center">' +
        '<div class="btn-group mb-3" role="group" id="calc-term-group">' +
        '<button type="button" class="btn btn-outline-green" data-term="15">15 Yr</button>' +
        '<button type="button" class="btn btn-outline-green active" data-term="30">30 Yr</button></div>' +
        '<div class="gray-box p-3"><div class="fs-9 text-brown">Estimated Monthly Payment</div>' +
        '<div id="mort-calc-total" class="fs-3 bold text-dark-green mt-1">--</div>' +
        '<div id="mort-calc-savings" class="fs-9 text-brown mt-1"></div></div>' +
        '</div></div></div></div></div>';
      document.body.appendChild(wrap.firstChild);
    }

    var calcResult = document.getElementById('mort-calc-total');
    if (calcResult && !document.querySelector('.oi-calc')) {
      var priceEl = document.querySelector('[data-live="price"]');
      var price = Number((priceEl && priceEl.textContent || '').replace(/[^0-9.]/g, '')) || 0;
      var trigger = document.querySelector('[data-bs-target="#payment-calculator"]');
      // Live, not baked: per-community tax is baked (stable), but the monthly AND the
      // "Savings Over 30 Years" compute from the company Settings rates below.
      var taxMult = Number(trigger && trigger.getAttribute('data-tax')) || 2.2;
      var savingEl = document.getElementById('calculator-promo-saving');   // under the price
      var calcSaveEl = document.getElementById('mort-calc-savings');       // in the modal
      var mortgageRate = 6.2, incentiveRate = 4.99, term = 30;
      var renderCalc = function () {
        if (!price) { calcResult.textContent = '--'; return; }
        calcResult.textContent = money(monthlyPayment(price, { rate: mortgageRate, taxMult: taxMult, term: term })) + '/mo';
        // 30-year savings = (standard P&I − incentive P&I) × 360.
        var save = Math.round((principalInterest(price, mortgageRate) - principalInterest(price, incentiveRate)) * 360);
        var savingTxt = save > 0 ? money(save) + ' Savings Over 30 Years' : '';
        if (savingEl) { savingEl.textContent = savingTxt || 'Savings Over 30 Years'; }
        if (calcSaveEl) { calcSaveEl.textContent = savingTxt; }
      };
      renderCalc();
      fetchT(API + '/settings').then(function (r) { return r.json(); }).then(function (d) {
        var s = d.settings || {};
        if (Number(s.mortgage_rate)) mortgageRate = Number(s.mortgage_rate);
        if (Number(s.incentive_rate)) incentiveRate = Number(s.incentive_rate);
        renderCalc();
      }).catch(function () {});
      var termGroup = document.getElementById('calc-term-group');
      if (termGroup) termGroup.addEventListener('click', function (e) {
        var btn = e.target.closest && e.target.closest('[data-term]'); if (!btn) return;
        term = Number(btn.getAttribute('data-term'));
        Array.prototype.forEach.call(termGroup.children, function (b) { b.classList.toggle('active', b === btn); });
        renderCalc();
      });
    }

    // Open the calculator modal when arriving via #mortgage-calculator (card links).
    if (location.hash === '#mortgage-calculator') {
      var calcModal = document.getElementById('payment-calculator');
      if (calcModal && window.bootstrap) bootstrap.Modal.getOrCreateInstance(calcModal).show();
    }

    // ponytail: the old #recommended QMI-card hydration is gone — generated pages now
    // ship a static Recommended For You floor-plan carousel (sections.mjs).
  })();
}
