// Enquiries are sent through Formspree to info@cmglobaldistribution.co.uk. Emptying this makes the
// form fall back to opening the visitor's own email app with the enquiry written out.
const FORM_ENDPOINT = 'https://formspree.io/f/mqpajwpl';

// A page opened from a link always starts at the top. Only the back and forward buttons, or a
// link to a named section, return the visitor to a place further down.
(() => {
  const nav = performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null;
  if (location.hash || (nav && nav.type === 'back_forward')) return;
  const top = () => window.scrollTo(0, 0);
  top();
  window.addEventListener('load', top, { once: true });
})();

// Mobile menu
(() => {
  const toggle = document.querySelector('.menu-toggle');
  const menu = document.getElementById('menu');
  if (!toggle || !menu) return;

  // It eases down from the bar when opened and lifts away a little faster when closed
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  let closing = 0;
  const setOpen = (open) => {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? 'Close' : 'Menu';
    clearTimeout(closing);
    if (!open && menu.classList.contains('is-open') && !still.matches) {
      menu.classList.add('is-closing');
      closing = setTimeout(() => menu.classList.remove('is-closing'), 200);
    } else menu.classList.remove('is-closing');
    menu.classList.toggle('is-open', open);
  };

  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  // A tap anywhere outside the open menu closes it
  document.addEventListener('click', (e) => {
    if (menu.classList.contains('is-open') && !menu.contains(e.target) && !toggle.contains(e.target)) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu.classList.contains('is-open')) {
      setOpen(false);
      toggle.focus();
    }
  });
})();

// Questions that open to show an answer glide open rather than snapping, the answer easing in
// just behind; closing is a touch quicker. A second tap mid-way turns it round from where it is.
(() => {
  const items = document.querySelectorAll('.faq details, .risks details');
  if (!items.length || !Element.prototype.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const OUT = 'cubic-bezier(0.22, 1, 0.36, 1)', IN_OUT = 'cubic-bezier(0.4, 0, 0.2, 1)';
  items.forEach((d) => {
    const summary = d.querySelector('summary');
    if (!summary) return;
    const body = [...d.children].filter((el) => el !== summary);
    let run = null;
    summary.addEventListener('click', (e) => {
      e.preventDefault();
      const from = d.getBoundingClientRect().height; // where it is now, even part-way through a move
      const fade = body.map((el) => parseFloat(getComputedStyle(el).opacity)); // and how visible the answer is
      if (run) run.cancel();
      body.forEach((el) => el.getAnimations().forEach((a) => a.cancel()));
      const opening = !d.open || d.classList.contains('is-closing');
      d.open = true;
      const full = d.getBoundingClientRect().height;
      d.open = false;
      const shut = d.getBoundingClientRect().height;
      d.open = true;
      d.style.overflow = 'hidden';
      d.classList.toggle('is-closing', !opening);
      if (opening) {
        run = d.animate({ height: [`${from}px`, `${full}px`] }, { duration: 380, easing: OUT });
        body.forEach((el, i) => el.animate({ opacity: [from > shut + 1 ? fade[i] : 0, 1], transform: ['translateY(-6px)', 'none'] }, { duration: 340, delay: 60, easing: OUT, fill: 'backwards' }));
      } else {
        run = d.animate({ height: [`${from}px`, `${shut}px`] }, { duration: 260, easing: IN_OUT });
        body.forEach((el, i) => el.animate({ opacity: [fade[i], 0] }, { duration: 180, easing: IN_OUT, fill: 'forwards' }));
      }
      run.onfinish = () => {
        if (d.classList.contains('is-closing')) { d.open = false; d.classList.remove('is-closing'); }
        body.forEach((el) => el.getAnimations().forEach((a) => a.cancel()));
        d.style.overflow = '';
        run = null;
      };
    });
  });
})();

// FAQ page: the topic list marks the section being read, so "Back to topics" returns to a list
// that shows where the reader was. On narrower screens a small label also travels with the
// questions once the list has gone, naming the topic and leading back to it. Both are worked out
// from the page's position on every scroll, so they can never disagree with what is on screen.
(() => {
  const links = [...document.querySelectorAll('.faq-nav a')];
  const groups = [...document.querySelectorAll('.faq-group')];
  const list = document.getElementById('faq-topics');
  if (!links.length || !groups.length || !list) return;
  const where = document.querySelector('.faq-where');
  const whereTopic = where && where.querySelector('.faq-where-topic');
  let current = '', hold = 0;
  const mark = (id) => {
    if (id === current) return;
    current = id;
    links.forEach((a) => {
      const on = a.getAttribute('href') === `#${id}`;
      if (on) {
        a.setAttribute('aria-current', 'true');
        if (whereTopic) { whereTopic.textContent = a.textContent; where.setAttribute('aria-label', `Back to all topics. Reading: ${a.textContent}`); }
      } else a.removeAttribute('aria-current');
    });
  };
  const READ_LINE = 130; // just under the header and the label, where the reader's eye is
  let queued = false;
  const update = () => {
    queued = false;
    if (Date.now() >= hold) {
      const g = groups.find((el) => { const r = el.getBoundingClientRect(); return r.top <= READ_LINE && r.bottom > READ_LINE; });
      if (g) mark(g.id);
    }
    if (!where) return;
    // shown once the list has gone and the topic's own heading has passed under the header, so the
    // label never sits just above the same words
    const head = current && document.getElementById(`${current}-title`);
    const headGone = !head || head.getBoundingClientRect().bottom < 90;
    where.classList.toggle('is-shown', list.getBoundingClientRect().bottom < 0 && Boolean(current) && headGone);
  };
  window.addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
  // a jump back to the list keeps the topic the reader came from marked
  document.querySelectorAll('a[href="#faq-topics"]').forEach((a) => a.addEventListener('click', () => {
    const from = a.closest('.faq-group');
    if (from) mark(from.id);
    hold = Date.now() + 900;
  }));
  update();
})();

// FAQ page: open or close every answer at once, for reading straight through or printing
(() => {
  const toggle = document.querySelector('.faq-all');
  if (!toggle) return;
  const items = [...document.querySelectorAll('.faq details')];
  const label = (open) => {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? 'Close all answers' : 'Open all answers';
  };
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    items.forEach((d) => { d.getAnimations().forEach((a) => a.cancel()); d.classList.remove('is-closing'); d.style.overflow = ''; d.open = open; });
    label(open);
  });
  // opening or closing answers one by one keeps the button's word true
  items.forEach((d) => d.addEventListener('toggle', () => {
    if (items.every((x) => x.open)) label(true);
    else if (items.every((x) => !x.open)) label(false);
  }));
})();

// Enquiry form: one form, two versions. The visitor picks trade buyer or brand owner,
// and only the questions for that side are shown, checked and sent.
(() => {
  const form = document.getElementById('enquiry');
  if (!form) return;

  const status = document.getElementById('form-status');
  const boxTitle = document.getElementById('email-box-title');
  try { localStorage.removeItem('cm-enquiry-draft'); } catch { /* answers are no longer kept; clear any left from before */ }
  const side = new URLSearchParams(location.search).get('type');
  const title = document.getElementById('contact-title');
  const lede = document.getElementById('contact-lede');
  // The heading stays the same whichever side is chosen; the form below it does the adapting
  const direct = document.querySelector('.contact-direct');
  // The email box beside the form: copy the address in one tap
  document.querySelectorAll('[data-copy]').forEach((copy) => {
    const said = copy.parentElement.querySelector('[role="status"]'); // screen readers hear the result too
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(copy.dataset.copy); copy.textContent = 'Copied'; if (said) said.textContent = 'Email address copied'; }
      catch { // copying was blocked: select the address instead, so it's one keystroke away
        const address = copy.closest('.email-box')?.querySelector('.email-box-address');
        if (address) { const range = document.createRange(); range.selectNodeContents(address); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range); }
        copy.textContent = 'Address selected';
        if (said) said.textContent = 'Copying didn’t work, so the address is selected. Copy it from there.';
      }
      setTimeout(() => { copy.textContent = 'Copy address'; if (said) said.textContent = ''; }, 2500);
    });
  });
  const submit = form.querySelector('button[type="submit"]');
  if (!FORM_ENDPOINT) { // say plainly what the button will do until the form service is connected
    const how = document.createElement('p');
    how.className = 'hint form-how';
    how.textContent = 'Sending opens your email app with your enquiry written out, ready to send.';
    submit.after(how);
  }
  const sideGroups = [...form.querySelectorAll('[data-side]')];
  const chosenSide = () => form.querySelector('input[name="side"]:checked')?.value || '';

  const showSide = (side) => {
    sideGroups.forEach((el) => {
      const on = el.dataset.side === side;
      el.hidden = !on;
      el.querySelectorAll('input, select, textarea').forEach((f) => { f.disabled = !on; });
    });
    form.classList.toggle('has-side', Boolean(side));
    form.dataset.side = side || '';
  };

  function showError(field, message) {
    const error = document.getElementById(`${field}-error`);
    if (error) error.textContent = message;
    if (field === 'side') return;
    const input = form.elements[field];
    if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  // Preselect from ?type=brand / ?type=trade
  const preset = new URLSearchParams(location.search).get('type');
  if (preset === 'brand' || preset === 'trade') form.querySelector(`input[name="side"][value="${preset}"]`).checked = true;
  showSide(chosenSide());
  form.querySelectorAll('input[name="side"]').forEach((r) => r.addEventListener('change', () => {
    showSide(chosenSide());
    showError('side', '');
  }));

  const pick = (msg) => (v) => (v ? '' : msg);
  const checks = {
    side: () => (chosenSide() ? '' : 'Choose whether you’re a trade buyer or a brand owner.'),
    phone: (v) => {
      if (!v.trim()) return ''; // optional: we work online, so email is enough
      return v.replace(/\D/g, '').length >= 7 ? '' : 'Enter a full phone number, including the area code.';
    },
    email: (v) => {
      if (!v.trim()) return 'Enter your email address.';
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? '' : 'Enter an email address like name@company.com.';
    },
    // Trade buyers
    enquiry_type: pick('Choose your type of business.'),
    category: pick('Tell us the brands or product types you buy.'),
    markets: pick('Choose where you need delivery.'),
    volume: pick('Choose your rough monthly volume.'),
    // Brand owners
    brand_category: pick('Tell us about your range.'),
    current_markets: pick('Choose where you sell today.'),
    target_markets: pick('Choose the markets you want to reach.'),
    message: (v) => (v.trim().length >= 10 ? '' : 'Tell us how we can help. A sentence is enough.'),
  };
  const active = (field) => field === 'side' || (form.elements[field] && !form.elements[field].disabled);
  const valueOf = (field) => (field === 'side' ? chosenSide() : form.elements[field].value);

  Object.keys(checks).filter((f) => f !== 'side').forEach((field) => {
    const input = form.elements[field];
    if (!input) return;
    const recheck = () => {
      if (input.getAttribute('aria-invalid') === 'true') showError(field, checks[field](input.value));
    };
    input.addEventListener('blur', () => showError(field, checks[field](input.value)));
    input.addEventListener('input', recheck);
    input.addEventListener('change', recheck);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    status.className = 'form-status';
    status.textContent = '';

    let firstBad = null;
    Object.keys(checks).forEach((field) => {
      if (!active(field)) return;
      const msg = checks[field](valueOf(field));
      showError(field, msg);
      // a missing side focuses the whole choice, so neither card looks picked for the visitor
      if (msg && !firstBad) firstBad = field === 'side' ? form.querySelector('.side-picker') : form.elements[field];
    });
    if (firstBad) {
      firstBad.focus();
      return;
    }

    // Until the form service is connected, the enquiry goes by email instead: the visitor's own
    // email app opens with everything they entered already written out, ready to send
    if (!FORM_ENDPOINT) {
      const lines = [];
      const sideLabel = form.querySelector('input[name="side"]:checked + label');
      if (sideLabel) lines.push(`Getting in touch as: ${sideLabel.firstChild.textContent.trim()}`);
      [...form.elements].forEach((f) => {
        if (!f.name || f.name === 'side' || f.disabled || !f.value.trim()) return;
        const label = form.querySelector(`label[for="${f.id}"]`);
        const name = label ? label.firstChild.textContent.trim() : f.name;
        const value = f.tagName === 'SELECT' ? f.options[f.selectedIndex].text : f.value.trim();
        lines.push(f.name === 'message' ? `\n${value}` : `${name}: ${value}`);
      });
      const who = form.elements.company && form.elements.company.value.trim();
      const subject = `${chosenSide() === 'brand' ? 'Brand partnership enquiry' : 'Trade account enquiry'}${who ? ` from ${who}` : ''}`;
      window.location.href = `mailto:info@cmglobaldistribution.co.uk?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
      status.classList.add('is-success');
      status.textContent = 'Your email app should now be open with your enquiry written out. Press send there to reach us. If nothing opened, email info@cmglobaldistribution.co.uk.';
      return;
    }

    submit.disabled = true;
    submit.textContent = 'Sending…';
    try {
      const res = await fetch(FORM_ENDPOINT, {
        method: 'POST',
        body: (() => {
          const data = new FormData(form); // hidden (disabled) fields are left out automatically
          const who = form.elements.company && form.elements.company.value.trim();
          data.append('_subject', `${chosenSide() === 'brand' ? 'Brand partnership enquiry' : 'Trade account enquiry'}${who ? ` from ${who}` : ''}`);
          return data;
        })(),
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(String(res.status));
      // Sent: the form gives way to a confirmation that says what happens next, so it can't be
      // sent twice by mistake
      const sentSide = chosenSide();
      const sentTo = form.elements.email.value.trim();
      const done = document.createElement('section');
      done.className = 'form-done';
      done.tabIndex = -1;
      done.setAttribute('aria-labelledby', 'form-done-title');
      done.innerHTML = `<h2 id="form-done-title">Enquiry sent</h2>
        <p>${sentSide === 'brand' ? 'A member of the team will reply to <strong class="form-done-address"></strong> to arrange a conversation about your range.' : 'A member of the team will reply to <strong class="form-done-address"></strong>. If anything more is needed before your account opens, we&rsquo;ll set it out in that reply.'}</p>
        <div class="form-done-actions"><a class="btn btn-line" href="${sentSide === 'brand' ? 'brands.html' : 'trade.html'}">${sentSide === 'brand' ? 'Back to brand partnerships' : 'Back to trade accounts'}</a><button class="btn btn-line" type="button">Send another enquiry</button></div>`;
      done.querySelector('.form-done-address').textContent = sentTo;
      form.reset();
      if (preset === 'brand' || preset === 'trade') form.querySelector(`input[name="side"][value="${preset}"]`).checked = true;
      showSide(chosenSide());
      form.hidden = true;
      form.after(done);
      // the page around it now reads as finished, and the email box as a follow-up
      const before = { title: title && title.textContent, lede: lede && lede.textContent, box: boxTitle && boxTitle.textContent };
      if (title) title.textContent = 'Thank you.';
      if (lede) lede.hidden = true; // the panel below says what happens next; once is enough
      if (boxTitle) boxTitle.textContent = 'Need to add something?';
      if (direct) direct.hidden = true; // the email route is offered once, below, as a follow-up
      // bring the thank-you into view first (on a phone it would sit under the header), then
      // give the panel focus without moving the page again
      if (title) title.scrollIntoView({ block: 'start' });
      done.focus({ preventScroll: true });
      done.querySelector('button').addEventListener('click', () => {
        done.remove();
        if (title) title.textContent = before.title;
        if (lede) { lede.textContent = before.lede; lede.hidden = false; }
        if (boxTitle) boxTitle.textContent = before.box;
        if (direct) direct.hidden = false;
        if (sentSide) { form.querySelector(`input[name="side"][value="${sentSide}"]`).checked = true; showSide(sentSide); } // carry on as the same side
        form.hidden = false;
        form.elements.email.value = sentTo; // a repeat enquiry needn't retype the address
        form.querySelector('input:not([type="radio"]), select, textarea').focus();
      });
    } catch {
      status.classList.add('is-error');
      status.textContent = 'Your enquiry didn’t send. Check your connection and try again, or email info@cmglobaldistribution.co.uk.';
    } finally {
      submit.disabled = false;
      submit.textContent = 'Send enquiry';
    }
  });
})();

// Tab switchers: click, or arrow keys once a tab has focus
document.querySelectorAll('[data-tabs]').forEach((root) => {
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const select = (tab, focus) => {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    });
    if (focus) tab.focus();
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', (e) => {
      const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      select(tabs[(next + tabs.length) % tabs.length], true);
    });
  });
});

// Liquid glass: the highlight on the glass panels drifts as the page scrolls
(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const root = document.documentElement;
  let queued = false;
  const move = () => {
    queued = false;
    root.style.setProperty('--sheen', (100 - (window.scrollY * 0.06) % 100).toFixed(1));
  };
  window.addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(move); } }, { passive: true });
  move();
})();

// Phones: the floating contact button stays in reach once the visitor is past the first screen,
// whenever they pause or scroll back up. It hides whenever another contact button is already on screen, so it
// never covers one, and while one of the home page's story pictures fills the middle of the screen.
(() => {
  const btn = document.querySelector('.mobile-cta');
  if (!btn) return;
  const onScreen = new Set();
  const gaps = [...document.querySelectorAll('.story-gap')];
  const closing = document.getElementById('choose-head');
  let atClose = false, reading = false, lastY = window.scrollY, idle = 0;
  const update = () => {
    const vh = window.innerHeight, y = window.scrollY;
    // Like Safari's toolbar: it slides away while the visitor reads on down the page, so it never
    // sits over the words, and comes back when they scroll up or pause
    if (y > lastY + 4) {
      reading = true;
      clearTimeout(idle);
      idle = setTimeout(() => { reading = false; update(); }, 1200);
    } else if (y < lastY - 4) reading = false;
    if (Math.abs(y - lastY) > 4) lastY = y;
    const overPicture = gaps.some((g) => { const r = g.getBoundingClientRect(); return r.height > 0 && r.top < vh * 0.6 && r.bottom > vh * 0.4; });
    // The closing section is itself the choice of how to get in touch, so the button steps aside
    // as soon as it arrives, and only comes back once the visitor is well clear of it again
    if (closing) { const t = closing.getBoundingClientRect().top; atClose = atClose ? t < vh + 200 : t < vh; }
    btn.classList.toggle('is-visible', y > vh * 1.2 && !reading && onScreen.size === 0 && !overPicture && !atClose);
  };
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => (e.isIntersecting ? onScreen.add(e.target) : onScreen.delete(e.target)));
      update();
    });
    document.querySelectorAll('main a.btn[href^="contact.html"], .site-footer a.btn').forEach((b) => io.observe(b));
  }
  window.addEventListener('scroll', update, { passive: true });
  update();
})();


// Header: stays at the top of every page, and slims down once the visitor starts scrolling
(() => {
  const header = document.querySelector('.site-header');
  if (!header) return;
  const update = () => header.classList.toggle('is-compact', window.scrollY > 40);
  window.addEventListener('scroll', update, { passive: true });
  update();
})();

// Order route: the line draws itself stop by stop, once, when it first comes into view.
// Without JavaScript, or with reduced motion, it is simply shown fully drawn.
(() => {
  const route = document.querySelector('[data-route]');
  if (!route || !('IntersectionObserver' in window)) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (route.getBoundingClientRect().top < window.innerHeight * 0.8) return;
  route.classList.add('is-waiting');
  const io = new IntersectionObserver((entries) => {
    if (!entries[0].isIntersecting) return;
    route.classList.remove('is-waiting');
    io.disconnect();
  }, { rootMargin: '0px 0px -35% 0px' }); // lights up once its top is well into view, however tall it is
  io.observe(route);
})();
