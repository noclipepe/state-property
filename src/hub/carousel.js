// Keep the real cards (and their controls) while recycling only offscreen cards.
// Touch panning stays native; the release settles one or more cards in its direction.
export function createCarousel(list) {
  const cards = [...list.children];
  if (cards.length < 3) return;
  const mobile = matchMedia('(max-width: 639px), (orientation: landscape) and (max-height: 540px) and (max-width: 960px)');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let enabled = false, step = 0, max = 0, offset = 0, width = 0;
  let frame = 0, idle = 0, resizeFrame = 0, gesture = null, blockClickUntil = 0;
  let selected = cards[0];

  const position = () => list.scrollLeft + offset;
  function distanceToCenter(card) {
    const r = card.getBoundingClientRect(), rail = list.getBoundingClientRect();
    return r.left + r.width / 2 - rail.left - list.clientWidth / 2;
  }
  function nearest() {
    return cards.reduce((a, b) => Math.abs(distanceToCenter(a)) < Math.abs(distanceToCenter(b)) ? a : b);
  }
  function stop() {
    cancelAnimationFrame(frame); frame = 0;
    clearTimeout(idle);
    list.classList.remove('is-settling');
  }
  function place(value, write = true) {
    let left = value - offset, moved = false;
    // The buffer is smaller than a card, so only entirely offscreen nodes move.
    if (max > step + 48) {
      while (left < 24) {
        list.prepend(list.lastElementChild);
        offset -= step; left += step; moved = true;
      }
      while (left > max - 24) {
        list.append(list.firstElementChild);
        offset += step; left -= step; moved = true;
      }
    }
    if (write || moved) list.scrollLeft = left;
  }
  function settle(target) {
    stop();
    const from = position(), distance = target - from;
    if (reduced.matches || Math.abs(distance) < 1) {
      place(target); selected = nearest(); return;
    }
    const start = performance.now(), duration = Math.min(360, 220 + Math.abs(distance) * 0.14);
    list.classList.add('is-settling');
    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      place(from + distance * (1 - Math.pow(1 - t, 4)));
      if (t < 1) frame = requestAnimationFrame(tick);
      else { frame = 0; selected = nearest(); list.classList.remove('is-settling'); }
    }
    frame = requestAnimationFrame(tick);
  }
  function settleNearest() {
    if (!enabled || gesture || frame) return;
    settle(position() + distanceToCenter(nearest()));
  }
  function layout() {
    stop(); gesture = null;
    const index = cards.indexOf(selected);
    list.replaceChildren(...cards.map((_, i) => cards[(index + i - 1 + cards.length) % cards.length]));
    offset = 0; list.scrollLeft = 0;
    step = cards[0].getBoundingClientRect().width + parseFloat(getComputedStyle(list).columnGap);
    max = list.scrollWidth - list.clientWidth; width = list.clientWidth;
    place(distanceToCenter(selected));
  }
  function configure() {
    enabled = mobile.matches;
    list.classList.toggle('is-looping', enabled);
    stop(); gesture = null;
    if (enabled) layout();
    else { list.replaceChildren(...cards); offset = 0; list.scrollLeft = 0; }
  }

  list.addEventListener('scroll', () => {
    if (!enabled) return;
    place(position(), false);
    clearTimeout(idle);
    if (!gesture && !frame) idle = setTimeout(settleNearest, 80);
  }, { passive: true });
  list.addEventListener('touchstart', event => {
    if (!enabled) return;
    stop(); blockClickUntil = 0;
    if (event.touches.length !== 1) { gesture = null; return; }
    const touch = event.touches[0];
    gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, axis: null,
      origin: position() + distanceToCenter(nearest()), samples: [{ x: touch.clientX, t: event.timeStamp }] };
  }, { passive: true });
  list.addEventListener('touchmove', event => {
    if (!gesture) return;
    if (event.touches.length !== 1) { gesture = null; return; }
    const touch = event.touches[0], dx = touch.clientX - gesture.x, dy = touch.clientY - gesture.y;
    if (!gesture.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 9) {
      if (Math.abs(dx) > Math.abs(dy) * 1.2) gesture.axis = 'x';
      else if (Math.abs(dy) > Math.abs(dx) * 1.2) gesture.axis = 'y';
    }
    gesture.samples.push({ x: touch.clientX, t: event.timeStamp });
    gesture.samples = gesture.samples.filter(s => event.timeStamp - s.t <= 100);
  }, { passive: true });
  list.addEventListener('touchend', event => {
    if (!gesture) return;
    const g = gesture, touch = [...event.changedTouches].find(t => t.identifier === g.id);
    gesture = null;
    if (!touch || g.axis !== 'x') return;
    const travel = g.x - touch.clientX;
    blockClickUntil = performance.now() + 400;
    if (Math.abs(travel) < 14) { settleNearest(); return; }
    const first = g.samples[0], last = g.samples.at(-1);
    const velocity = event.timeStamp - last.t < 80 && last.t > first.t ? (first.x - last.x) / (last.t - first.t) : 0;
    const extra = Math.sign(velocity) === Math.sign(travel) ? Math.abs(velocity) * 180 : 0;
    const count = Math.max(1, Math.min(3, Math.round((Math.abs(travel) + extra) / step)));
    settle(g.origin + Math.sign(travel) * count * step);
  }, { passive: true });
  list.addEventListener('touchcancel', () => { gesture = null; if (enabled) idle = setTimeout(settleNearest, 80); }, { passive: true });
  // A horizontal drag over PLAY must not turn into a link click on release.
  list.addEventListener('click', event => {
    if (enabled && event.detail && performance.now() < blockClickUntil) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);
  list.addEventListener('focusin', event => {
    if (!enabled || gesture || event.target.closest('.fisherman-skin')) return;
    const card = event.target.closest('.card');
    if (card) settle(position() + distanceToCenter(card));
  });
  new ResizeObserver(() => {
    if (!enabled || width === list.clientWidth) return;
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(layout);
  }).observe(list);
  mobile.addEventListener('change', configure);
  addEventListener('pagehide', () => { stop(); gesture = null; });
  addEventListener('pageshow', () => { if (enabled) layout(); });
  configure();
}
