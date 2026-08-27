// testimonial-shuffle.js — live picks a random testimonial set server-side on every
// load of /design-studio/; the static mirror bakes one draw. Shuffle the baked cards
// client-side so each load varies like live. ponytail: only the scraped draw's 4
// cards exist to shuffle; wire to a fuller testimonial source if rotation depth matters.
(function () {
  var h = Array.prototype.find.call(document.querySelectorAll('h2'), function (x) {
    return /What Our Customers Are Saying/i.test(x.textContent);
  });
  var section = h && h.closest('section');
  var row = section && section.querySelector('.row.justify-content-center');
  if (!row || row.children.length < 2) return;
  var cards = Array.prototype.slice.call(row.children);
  for (var i = cards.length; i > 0; i--) {
    row.appendChild(cards.splice(Math.floor(Math.random() * i), 1)[0]);
  }
})();
