document.addEventListener('DOMContentLoaded', function () {

  // ---------- Mobile nav toggle ----------
  const navToggle = document.querySelector('.nav-toggle');
  const navLinks = document.querySelector('.nav-links');
  if (navToggle && navLinks) {
    navToggle.addEventListener('click', () => {
      navLinks.classList.toggle('open');
      navToggle.innerHTML = navLinks.classList.contains('open')
        ? '<i class="fa-solid fa-xmark"></i>'
        : '<i class="fa-solid fa-bars"></i>';
    });
  }

  // ---------- Dashboard sidebar toggle (mobile) ----------
  const sidebarToggle = document.querySelector('.sidebar-toggle');
  const sidebar = document.querySelector('.dash-sidebar');
  if (sidebarToggle && sidebar) {
    sidebarToggle.addEventListener('click', () => sidebar.classList.toggle('open'));
    document.addEventListener('click', (e) => {
      if (sidebar.classList.contains('open') && !sidebar.contains(e.target) && !sidebarToggle.contains(e.target)) {
        sidebar.classList.remove('open');
      }
    });
  }

  // ---------- Password visibility toggle ----------
  document.querySelectorAll('.password-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      btn.textContent = isPassword ? 'Hide' : 'Show';
    });
  });

  // ---------- Toggle-button groups (role select, gender select, etc.) ----------
  document.querySelectorAll('.role-option').forEach(opt => {
    opt.addEventListener('click', () => {
      const group = opt.closest('.role-select') || opt.parentElement;
      group.querySelectorAll('.role-option').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      const input = opt.querySelector('input');
      if (input) input.checked = true;
    });
  });

  // ---------- Avatar upload preview ----------
  document.querySelectorAll('input[type="file"][data-preview]').forEach(input => {
    input.addEventListener('change', () => {
      const preview = document.getElementById(input.dataset.preview);
      const file = input.files && input.files[0];
      if (!preview || !file) return;
      const reader = new FileReader();
      reader.onload = (e) => { preview.src = e.target.result; };
      reader.readAsDataURL(file);
    });
  });

  // ---------- FAQ accordion ----------
  document.querySelectorAll('.faq-item').forEach(item => {
    const q = item.querySelector('.faq-q');
    if (q) q.addEventListener('click', () => {
      const wasOpen = item.classList.contains('open');
      document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));
      if (!wasOpen) item.classList.add('open');
    });
  });

  // ---------- Toasts (auto-render flash messages, auto dismiss) ----------
  document.querySelectorAll('.toast').forEach(toast => {
    setTimeout(() => {
      toast.style.transition = 'opacity .3s ease, transform .3s ease';
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(20px)';
      setTimeout(() => toast.remove(), 300);
    }, 4500);
  });

  // ---------- Confirmation dialogs for destructive actions ----------
  document.querySelectorAll('[data-confirm]').forEach(form => {
    form.addEventListener('submit', (e) => {
      const msg = form.getAttribute('data-confirm') || 'Are you sure?';
      if (!confirm(msg)) e.preventDefault();
    });
  });

  // ---------- Star rating input ----------
  document.querySelectorAll('.star-input').forEach(container => {
    const stars = container.querySelectorAll('i');
    const hiddenInput = document.getElementById(container.dataset.for);
    function paint(count) {
      stars.forEach((s, idx) => s.classList.toggle('active', idx < count));
    }
    stars.forEach((star, idx) => {
      star.addEventListener('mouseenter', () => paint(idx + 1));
      star.addEventListener('click', () => {
        if (hiddenInput) hiddenInput.value = idx + 1;
        paint(idx + 1);
      });
    });
    container.addEventListener('mouseleave', () => {
      paint(hiddenInput ? Number(hiddenInput.value || 0) : 0);
    });
  });

  // ---------- Client-side form validation ----------
  document.querySelectorAll('form[data-validate]').forEach(form => {
    form.addEventListener('submit', (e) => {
      let valid = true;
      form.querySelectorAll('[required]').forEach(field => {
        field.classList.remove('field-error');
        if (!field.value || !field.value.trim()) {
          valid = false;
          field.classList.add('field-error');
          field.style.borderColor = '#E2645C';
        } else {
          field.style.borderColor = '';
        }
      });

      const pw = form.querySelector('[name="password"]');
      const confirmPw = form.querySelector('[name="confirm_password"]');
      if (pw && confirmPw && pw.value !== confirmPw.value) {
        valid = false;
        confirmPw.style.borderColor = '#E2645C';
        alert('Passwords do not match.');
      }

      if (!valid) e.preventDefault();
    });
  });

  // ---------- Chat: scroll to bottom & submit-on-enter ----------
  const chatBody = document.querySelector('.chat-body');
  if (chatBody) chatBody.scrollTop = chatBody.scrollHeight;

  // ---------- Loading state on primary form submits ----------
  document.querySelectorAll('form').forEach(form => {
    form.addEventListener('submit', () => {
      const btn = form.querySelector('button[type="submit"]');
      if (btn && !form.hasAttribute('data-no-loading')) {
        setTimeout(() => {
          btn.dataset.originalText = btn.innerHTML;
          btn.innerHTML = 'Please wait...';
          btn.disabled = true;
        }, 0);
      }
    });
  });

  // ---------- Mini calendar widget (dashboard) ----------
  document.querySelectorAll('.mini-calendar').forEach(el => {
    let sessionDates = [];
    try { sessionDates = JSON.parse(el.dataset.sessions || '[]'); } catch (e) { sessionDates = []; }

    const today = new Date();
    let viewYear = today.getFullYear();
    let viewMonth = today.getMonth(); // 0-indexed

    function render() {
      const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      const firstDay = new Date(viewYear, viewMonth, 1).getDay();
      const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

      let html = `<div class="mini-calendar-head">
        <button type="button" data-dir="-1" aria-label="Previous month"><i class="fa-solid fa-chevron-left"></i></button>
        <strong>${monthNames[viewMonth]} ${viewYear}</strong>
        <button type="button" data-dir="1" aria-label="Next month"><i class="fa-solid fa-chevron-right"></i></button>
      </div>
      <div class="mini-calendar-grid">`;

      ['Su','Mo','Tu','We','Th','Fr','Sa'].forEach(d => { html += `<div class="dow">${d}</div>`; });
      for (let i = 0; i < firstDay; i++) html += `<div class="day empty"></div>`;

      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const isToday = viewYear === today.getFullYear() && viewMonth === today.getMonth() && d === today.getDate();
        const hasSession = sessionDates.includes(dateStr);
        const classes = ['day'];
        if (isToday) classes.push('today');
        if (hasSession) classes.push('has-session');
        html += `<div class="${classes.join(' ')}" title="${hasSession ? 'Session scheduled' : ''}">${d}</div>`;
      }
      html += `</div>`;
      el.innerHTML = html;

      el.querySelectorAll('.mini-calendar-head button').forEach(btn => {
        btn.addEventListener('click', () => {
          viewMonth += parseInt(btn.dataset.dir, 10);
          if (viewMonth < 0) { viewMonth = 11; viewYear--; }
          if (viewMonth > 11) { viewMonth = 0; viewYear++; }
          render();
        });
      });
    }
    render();
  });

  // ---------- Simple admin bar chart renderer (Canvas, vanilla JS) ----------
  document.querySelectorAll('canvas[data-chart]').forEach(canvas => {
    try {
      const data = JSON.parse(canvas.dataset.chart);
      drawBarChart(canvas, data);
    } catch (err) {
      console.error('Chart render error', err);
    }
  });

  function drawBarChart(canvas, data) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const padding = 36;
    const max = Math.max(1, ...data.map(d => d.value));
    const barWidth = (width - padding * 2) / data.length - 14;

    ctx.clearRect(0, 0, width, height);
    ctx.font = '11px Manrope, sans-serif';

    data.forEach((d, i) => {
      const barHeight = ((height - padding * 2) * d.value) / max;
      const x = padding + i * ((width - padding * 2) / data.length) + 7;
      const y = height - padding - barHeight;

      const gradient = ctx.createLinearGradient(0, y, 0, height - padding);
      gradient.addColorStop(0, '#D9A441');
      gradient.addColorStop(1, '#172B4D');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, barWidth, barHeight, 6);
      else ctx.rect(x, y, barWidth, barHeight);
      ctx.fill();

      ctx.fillStyle = '#4A5265';
      ctx.textAlign = 'center';
      ctx.fillText(d.value, x + barWidth / 2, y - 8);
      ctx.fillText(String(d.label).slice(0, 10), x + barWidth / 2, height - padding + 16);
    });
  }
});
