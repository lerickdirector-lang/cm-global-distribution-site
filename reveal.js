// Home: as each glass panel scrolls into view, its content slides in from the side the panel
// sits on, a piece at a time (headings, then text, then list items). It plays once per panel.
// Phones, where the panels are full width, get a gentle rise instead. With reduced motion, or
// if GSAP fails to load, nothing is hidden: the content is simply there.
(() => {
  if (!window.gsap || !window.ScrollTrigger) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  gsap.registerPlugin(ScrollTrigger);

  const PIECES = '.band-head > *, .split > div > *, .reach > div, .faq > details, .audiences > article, .choose-close';
  const wide = window.matchMedia('(min-width: 961px)').matches;

  // Route stops: each one slides in as it comes into view, its document is laid down beside
  // it, and the stamp presses onto the document just after
  document.querySelectorAll('.route-map > li').forEach((stop) => {
    const side = stop.closest('.side-left') ? -1 : stop.closest('.side-right') ? 1 : 0;
    const from = wide && side ? { x: side * 48, y: 0 } : { x: 0, y: 28 };
    const tl = gsap.timeline({ scrollTrigger: { trigger: stop, start: 'top 85%', toggleActions: 'play none none none' } });
    tl.from(stop, { ...from, opacity: 0, duration: 0.9, ease: 'power3.out', lazy: false })
      .from(stop.querySelector('.sheet'), { opacity: 0, y: -18, rotation: -8, duration: 0.6, ease: 'power3.out', lazy: false }, 0.25)
      .from(stop.querySelector('.sheet .stamp'), { scale: 1.5, opacity: 0, rotation: -24, duration: 0.4, ease: 'back.out(2.4)', lazy: false }, 0.75);
  });

  // Closing panels: each slides in from its own side
  document.querySelectorAll('.audience-cards > .glass-card').forEach((card, i) => {
    const from = wide ? { x: (i === 0 ? -1 : 1) * 56, y: 0 } : { x: 0, y: 28 };
    // A timeline owns each trigger here, as for the route stops: created on a page reloaded part-way
    // down, a trigger inside the tween itself fired, removed itself mid-setup and broke the script
    gsap.timeline({ scrollTrigger: { trigger: card, start: 'top 85%', toggleActions: 'play none none none' } })
      .from(card, { ...from, opacity: 0, duration: 0.9, ease: 'power3.out', lazy: false });
  });

  document.querySelectorAll('main .band-light:not(.glass-card)').forEach((panel) => {
    const pieces = [...new Set(panel.querySelectorAll(PIECES))].filter((el) => !el.classList.contains('faq'));
    if (!pieces.length) return;
    const side = panel.classList.contains('side-left') ? -1 : panel.classList.contains('side-right') ? 1 : 0;
    const from = wide && side ? { x: side * 48, y: 0 } : { x: 0, y: 28 };
    // The glass itself arrives with its words, so it is never seen as an empty frame
    gsap.timeline({ scrollTrigger: { trigger: panel, start: 'top 78%', toggleActions: 'play none none none' } })
      .from(panel, { opacity: 0, duration: 0.6, ease: 'power2.out', lazy: false }, 0)
      .from(pieces, {
      ...from,
      opacity: 0,
      duration: 0.9,
      ease: 'power3.out',
      stagger: 0.07,
      lazy: false, // hide the pieces at once, so none can be glimpsed before its turn
    }, 0.1);
  });
})();

// Home: the headline builds itself letter by letter when the page opens. "Authorised" first,
// then "branded stock", each letter rising out of a soft blur just after the one before.
// The page's own script only holds the headline back when motion is welcome; if GSAP is
// missing, a CSS fallback reveals it after a moment. Screen readers read the heading's
// label throughout, since the split letters sit inside parts they already skip.
(() => {
  const root = document.documentElement;
  const title = document.querySelector('.hero-title');
  if (!title || !root.classList.contains('hero-letters')) return;
  if (!window.gsap || !window.SplitText) return;
  gsap.registerPlugin(SplitText);
  document.fonts.ready.then(() => {
    const split = SplitText.create(title.querySelectorAll('.hero-word, .hero-main'), { type: 'words,chars', aria: 'none' });
    root.classList.add('hero-building'); // the rest of the hero now waits for the letters
    root.classList.remove('hero-letters');
    // The line and buttons fade in just behind the first letters, without waiting for the rest
    gsap.to(document.querySelectorAll('.scene-copy .lede, .scene-copy .actions, .hero-proof'), {
      opacity: 1, duration: 0.5, delay: 0.15, ease: 'power2.out', stagger: 0.08,
      onComplete: () => root.classList.remove('hero-building'),
    });
    gsap.from(split.chars, {
      opacity: 0,
      yPercent: 45,
      filter: 'blur(8px)',
      duration: 0.8,
      ease: 'power3.out',
      stagger: 0.025,
      lazy: false,
      onComplete: () => {
        split.revert(); // back to plain text once every letter has landed
      },
    });
  });
})();

// Home: the big headlines. On wide screens each line is sized so it lands exactly across the
// page, then the two lines slide in from opposite sides as the headline scrolls into view,
// following the scroll both ways. The page itself is never held or slowed. On phones the
// lines wrap at a fixed size; with reduced motion they simply sit in place.
(() => {
  const heads = [...document.querySelectorAll('.big-head')];
  if (!heads.length) return;
  // Both headlines share one size, the largest at which every line still fits across the
  // page, so neither looks accidentally bigger than the other
  const fit = () => {
    const lines = [...document.querySelectorAll('.big-line')];
    heads.forEach((head) => head.style.removeProperty('--big-size'));
    lines.forEach((l) => { l.style.fontSize = '100px'; l.style.display = 'inline-block'; });
    const widest = Math.max(...lines.map((l) => l.getBoundingClientRect().width));
    lines.forEach((l) => { l.style.fontSize = ''; l.style.display = ''; });
    const page = Math.min(heads[0].clientWidth, 1440);
    const room = page < 701 ? page - 32 : page * 0.9;
    // Never louder than the main headline by more than a touch: the offer stays the biggest idea
    const hero = parseFloat(getComputedStyle(document.querySelector('.hero-title') || document.body).fontSize) || 100;
    const size = `${Math.min(Math.floor((100 * room) / widest), Math.round(hero * 1.15), 240)}px`;
    heads.forEach((head) => head.style.setProperty('--big-size', size));
  };
  const start = () => {
    fit();
    if (!window.gsap || !window.ScrollTrigger || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    gsap.registerPlugin(ScrollTrigger);
    heads.forEach((head) => {
      head.querySelectorAll('.big-line').forEach((line, i) => {
        gsap.fromTo(line, { xPercent: i === 0 ? 38 : -38, opacity: 0.35 }, {
          xPercent: 0, opacity: 1, ease: 'none',
          scrollTrigger: { trigger: head, start: 'top bottom', end: 'center 60%', scrub: 0.6 }, // settled before it reaches the middle
        });
      });
    });
    ScrollTrigger.refresh();
  };
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(start);
  let t;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { fit(); window.ScrollTrigger && ScrollTrigger.refresh(); }, 150); });
})();
