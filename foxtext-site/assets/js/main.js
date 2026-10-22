/* =============================================================
   FoxText — landing page interactions
   Vanilla JS only. No dependencies, no build step.
   ============================================================= */
(function (window, document) {
  'use strict';

  var i18n = window.FoxTextI18n;
  var reduceMotion = false;

  try {
    reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (err) {
    reduceMotion = false;
  }

  function $(selector, scope) {
    return (scope || document).querySelector(selector);
  }

  function $$(selector, scope) {
    return Array.prototype.slice.call((scope || document).querySelectorAll(selector));
  }

  function t(key) {
    if (i18n && typeof i18n.t === 'function') {
      return i18n.t(key);
    }
    return '';
  }

  /* ---------------------------------------------------------------
     Toast
     --------------------------------------------------------------- */
  var toastEl = null;
  var toastTextEl = null;
  var toastTimer = null;

  function showToast(message) {
    if (!toastEl || !toastTextEl || !message) {
      return;
    }
    toastTextEl.textContent = message;
    toastEl.classList.add('is-show');
    if (toastTimer) {
      window.clearTimeout(toastTimer);
    }
    toastTimer = window.setTimeout(function () {
      toastEl.classList.remove('is-show');
      toastTimer = null;
    }, 1900);
  }

  /* ---------------------------------------------------------------
     Clipboard (with legacy fallback for file:// contexts)
     --------------------------------------------------------------- */
  function legacyCopy(text) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', 'readonly');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.left = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, area.value.length);

    var ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (err) {
      ok = false;
    }
    document.body.removeChild(area);
    return ok;
  }

  function copyText(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(text).catch(function () {
        if (legacyCopy(text)) {
          return Promise.resolve();
        }
        return Promise.reject(new Error('copy-failed'));
      });
    }
    if (legacyCopy(text)) {
      return Promise.resolve();
    }
    return Promise.reject(new Error('copy-failed'));
  }

  function bindCopyButtons() {
    $$('.copy-btn').forEach(function (button) {
      button.addEventListener('click', function () {
        var payload = button.getAttribute('data-copy') || '';
        if (!payload) {
          return;
        }
        copyText(payload).then(
          function () {
            showToast(t('misc.copied'));
            button.classList.add('is-copied');
            window.setTimeout(function () {
              button.classList.remove('is-copied');
            }, 1400);
          },
          function () {
            showToast(t('misc.copyFailed'));
          }
        );
      });
    });
  }

  /* ---------------------------------------------------------------
     Header: sticky glass state + mobile menu
     --------------------------------------------------------------- */
  function initHeader() {
    var header = $('#siteHeader');
    var toggle = $('#menuToggle');
    var menu = $('#mobileMenu');

    function syncScrollState() {
      if (!header) {
        return;
      }
      header.classList.toggle('is-scrolled', window.pageYOffset > 8);
    }

    function closeMenu() {
      if (!menu || !toggle) {
        return;
      }
      menu.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    }

    if (toggle && menu) {
      toggle.addEventListener('click', function () {
        var isOpen = menu.classList.toggle('is-open');
        toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      });

      $$('.mobile-link, .mobile-cta', menu).forEach(function (link) {
        link.addEventListener('click', closeMenu);
      });

      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' || event.keyCode === 27) {
          closeMenu();
        }
      });

      window.addEventListener('resize', function () {
        if (window.innerWidth > 900) {
          closeMenu();
        }
      });
    }

    syncScrollState();
    window.addEventListener('scroll', syncScrollState, { passive: true });
  }

  /* ---------------------------------------------------------------
     Back-to-top button
     --------------------------------------------------------------- */
  function initBackToTop() {
    var button = $('#toTop');
    if (!button) {
      return;
    }

    function sync() {
      var visible = window.pageYOffset > 600;
      if (visible) {
        button.removeAttribute('hidden');
      } else {
        button.setAttribute('hidden', 'hidden');
      }
    }

    button.addEventListener('click', function () {
      try {
        window.scrollTo({
          top: 0,
          behavior: reduceMotion ? 'auto' : 'smooth'
        });
      } catch (err) {
        window.scrollTo(0, 0);
      }
    });

    sync();
    window.addEventListener('scroll', sync, { passive: true });
  }

  /* ---------------------------------------------------------------
     Tabs
     --------------------------------------------------------------- */
  function initTabs() {
    var tabList = $('.tab-list');
    if (!tabList) {
      return;
    }

    var tabs = $$('.tab', tabList);
    var panels = $$('.tab-panel');

    function activate(index, focusTab) {
      tabs.forEach(function (tab, i) {
        var selected = i === index;
        tab.classList.toggle('is-active', selected);
        tab.setAttribute('aria-selected', selected ? 'true' : 'false');
        tab.setAttribute('tabindex', selected ? '0' : '-1');
        if (selected && focusTab) {
          tab.focus();
        }
      });

      panels.forEach(function (panel, i) {
        var selected = i === index;
        panel.classList.toggle('is-active', selected);
        if (selected) {
          panel.removeAttribute('hidden');
        } else {
          panel.setAttribute('hidden', 'hidden');
        }
      });
    }

    tabs.forEach(function (tab, index) {
      tab.addEventListener('click', function () {
        activate(index, false);
      });

      tab.addEventListener('keydown', function (event) {
        var key = event.key || '';
        var next = -1;

        if (key === 'ArrowRight' || key === 'ArrowDown' || event.keyCode === 39 || event.keyCode === 40) {
          next = (index + 1) % tabs.length;
        } else if (key === 'ArrowLeft' || key === 'ArrowUp' || event.keyCode === 37 || event.keyCode === 38) {
          next = (index - 1 + tabs.length) % tabs.length;
        } else if (key === 'Home' || event.keyCode === 36) {
          next = 0;
        } else if (key === 'End' || event.keyCode === 35) {
          next = tabs.length - 1;
        }

        if (next !== -1) {
          event.preventDefault();
          activate(next, true);
        }
      });
    });
  }

  /* ---------------------------------------------------------------
     Reveal on scroll
     --------------------------------------------------------------- */
  function initReveal() {
    var items = $$('.reveal');
    if (!items.length) {
      return;
    }

    // Stagger siblings so grids appear with a slight cascade.
    items.forEach(function (item) {
      var parent = item.parentNode;
      if (!parent) {
        return;
      }
      var index = 0;
      var sibling = item.previousElementSibling;
      while (sibling) {
        if (sibling.classList && sibling.classList.contains('reveal')) {
          index += 1;
        }
        sibling = sibling.previousElementSibling;
      }
      if (!reduceMotion && index > 0) {
        item.style.transitionDelay = Math.min(index, 5) * 70 + 'ms';
      }
    });

    if (reduceMotion || typeof window.IntersectionObserver !== 'function') {
      items.forEach(function (item) {
        item.classList.add('is-visible');
      });
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
    );

    items.forEach(function (item) {
      observer.observe(item);
    });
  }

  /* ---------------------------------------------------------------
     Placeholder links (`href="#"`) — demo site
     --------------------------------------------------------------- */
  function initPlaceholderLinks() {
    $$('a[href="#"]').forEach(function (link) {
      link.addEventListener('click', function (event) {
        event.preventDefault();
        showToast(t('footer.demo'));
      });
    });
  }

  /* ---------------------------------------------------------------
     Boot
     --------------------------------------------------------------- */
  function boot() {
    toastEl = $('#toast');
    toastTextEl = $('#toastText');

    initHeader();
    initBackToTop();
    initTabs();
    bindCopyButtons();
    initPlaceholderLinks();
    initReveal();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window, document);
