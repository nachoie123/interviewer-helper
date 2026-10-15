/* eslint-disable no-undef */
/**
 * Onboarding wizard: welcome → Groq API key → the user's profile (optional) → finish.
 * Everything is saved through the electronAPI bridge (preload.js): the key to <userData>/.env,
 * the profile to <userData>/profile.md.
 */

(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const screens = $$('.screen');
  const stepperDots = $$('.step-dot');
  const stepBadge = $('#stepBadge');
  const backBtn = $('#backBtn');
  const nextBtn = $('#nextBtn');

  const ORDER = ['welcome', 'apikey', 'profile', 'finish'];
  const state = { groqKey: '', groqConfigured: false, profile: '' };

  function currentScreenName() {
    const active = Array.from(screens).find((s) => s.classList.contains('active'));
    return active ? active.dataset.screen : 'welcome';
  }

  function showScreen(name) {
    const step = ORDER.indexOf(name);
    screens.forEach((s) => s.classList.toggle('active', s.dataset.screen === name));
    document.getElementById('wizard').classList.toggle('welcome-active', name === 'welcome');
    stepBadge.textContent = `Step ${step + 1} of ${ORDER.length}`;
    stepperDots.forEach((dot, i) => {
      dot.classList.toggle('done', i < step);
      dot.classList.toggle('active', i === step);
    });
    backBtn.style.visibility = step === 0 ? 'hidden' : 'visible';
    nextBtn.innerHTML = name === 'finish'
      ? 'Finish <i class="fas fa-check"></i>'
      : name === 'profile' && !state.profile.trim()
        ? 'Skip for now <i class="fas fa-arrow-right"></i>'
        : 'Continue <i class="fas fa-arrow-right"></i>';
    if (name === 'finish') populateSummary();
  }

  // ── Groq key ──────────────────────────────────────────────────────
  const keyInput = $('#groqKey');
  const keyStatus = $('#keyStatus');

  function setKeyStatus(kind, text) {
    keyStatus.className = `status-pill ${kind}`;
    keyStatus.style.display = 'inline-flex';
    keyStatus.querySelector('i').className = {
      success: 'fas fa-check-circle',
      error: 'fas fa-circle-xmark'
    }[kind] || 'fas fa-circle-info';
    keyStatus.querySelector('.text').textContent = text;
  }

  keyInput.addEventListener('input', () => {
    state.groqKey = keyInput.value.trim();
    if (!state.groqKey) keyStatus.style.display = 'none';
    else setKeyStatus(/^gsk_/.test(state.groqKey) ? 'idle' : 'error',
      /^gsk_/.test(state.groqKey) ? 'Key entered' : 'Groq keys start with gsk_');
  });

  $('#toggleVis').addEventListener('click', () => {
    const showing = keyInput.type === 'text';
    keyInput.type = showing ? 'password' : 'text';
    $('#toggleVis').innerHTML = showing ? '<i class="fas fa-eye"></i>' : '<i class="fas fa-eye-slash"></i>';
  });

  // ── Profile ───────────────────────────────────────────────────────
  const profileInput = $('#profileText');
  profileInput.addEventListener('input', () => {
    state.profile = profileInput.value;
    showScreen('profile');
  });
  $('#loadProfileBtn').addEventListener('click', async (e) => {
    e.preventDefault();
    const text = await window.electronAPI.pickProfileFile();
    if (text == null) return;
    profileInput.value = state.profile = text;
    showScreen('profile');
  });

  // ── Finish ────────────────────────────────────────────────────────
  function populateSummary() {
    const hasKey = !!(state.groqKey || state.groqConfigured);
    const words = state.profile.trim() ? state.profile.trim().split(/\s+/).length : 0;
    const rows = [
      { label: '<i class="fas fa-key"></i> Groq API key', value: hasKey ? 'Saved' : 'Missing', cls: hasKey ? 'ok' : 'skip' },
      { label: '<i class="fas fa-user"></i> Your profile', value: words ? `${words} words` : 'Not added (placeholders)', cls: words ? 'ok' : 'skip' }
    ];
    $('#summaryList').innerHTML = rows.map((r) => `
        <div class="summary-row">
          <div class="label">${r.label}</div>
          <div class="value ${r.cls}">${r.value}</div>
        </div>`).join('');
  }

  $('#starBtn').addEventListener('click', () => {
    window.electronAPI.openExternal('https://github.com/nachoie123/interviewer-helper');
  });

  // ── Nav ───────────────────────────────────────────────────────────
  $('#heroCtaBtn').addEventListener('click', () => nextBtn.click());

  nextBtn.addEventListener('click', async () => {
    const name = currentScreenName();
    if (name === 'apikey') {
      if (!state.groqKey && !state.groqConfigured) {
        setKeyStatus('error', 'Paste your Groq API key to continue');
        return;
      }
      if (state.groqKey && !/^gsk_/.test(state.groqKey)) {
        setKeyStatus('error', 'Groq keys start with gsk_');
        return;
      }
      if (state.groqKey) await window.electronAPI.saveSettings({ groqKey: state.groqKey });
    }
    if (name === 'profile' && state.profile.trim()) {
      await window.electronAPI.saveProfile(state.profile);
    }
    if (name === 'finish') {
      try { await window.electronAPI.completeFirstRun(); } catch (_) { /* ignore */ }
      try { await window.electronAPI.closeOnboarding(); } catch (_) { /* ignore */ }
      return;
    }
    showScreen(ORDER[ORDER.indexOf(name) + 1]);
  });

  backBtn.addEventListener('click', () => {
    const i = ORDER.indexOf(currentScreenName());
    if (i > 0) showScreen(ORDER[i - 1]);
  });

  // ── Boot ──────────────────────────────────────────────────────────
  showScreen('welcome');
  // Reopened from the ··· menu: jump straight to the key or profile screen
  window.electronAPI.receive('onboarding-goto', (_e, screen) => {
    if (ORDER.includes(screen)) showScreen(screen);
  });
  window.electronAPI.getFirstRunStatus().then((s) => {
    if (s && s.groqConfigured) {
      state.groqConfigured = true;
      setKeyStatus('success', 'Already saved: click Continue');
      keyInput.placeholder = '•••••••••••••••• (already set)';
    }
  }).catch(() => {});
  window.electronAPI.getProfile().then((text) => {
    if (text && !state.profile) profileInput.value = state.profile = text;
  }).catch(() => {});
})();
