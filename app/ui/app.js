(function() {
  const api = window.omricode;
  if (!api) { document.body.innerHTML = '<div style="padding:20px;color:red">Bridge not loaded</div>'; return; }

  // ─── DOM refs ───
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  const titlebar = $('#titlebar');
  const messagesEl = $('#messagesContainer');
  const inputEl = $('#chatInput');
  const sendBtn = $('#sendBtn');
  const statusEl = $('#statusText');
  const activityText = $('#activityText');
  const activityDot = $('#activityDot');
  const onboardingEl = $('#onboardingWizard');

  let isProcessing = false;
  let currentAssistantId = null;
  let settings = {};
  let providers = [];
  let pendingToolExecutionId = null;

  // ─── Window controls ───
  $('#btnMinimize').onclick = () => api.minimize();
  $('#btnMaximize').onclick = () => api.maximize();
  $('#btnClose').onclick = () => api.close();

  // ─── Drag titlebar ───
  let isDragging = false, startX, startY, startWinX, startWinY;
  titlebar.onmousedown = (e) => {
    if (e.target.closest('.titlebar-actions')) return;
    isDragging = true;
    startX = e.screenX; startY = e.screenY;
    // Electron provides window bounds via IPC, but for simplicity we just use -webkit-app-region
  };

  // ─── Navigation ───
  function navigate(page) {
    $$('.page').forEach(p => p.classList.remove('active'));
    const el = document.getElementById('page' + page.charAt(0).toUpperCase() + page.slice(1));
    if (el) el.classList.add('active');
  }

  $('#navChat').onclick = () => navigate('chat');
  $('#navSettings').onclick = () => navigate('settings');

  api.onNavigate((page) => navigate(page));
  api.onWindowState((state) => {});

  // ─── Initialize ───
  api.onInit((data) => {
    settings = data.settings;
    providers = data.providers;
    applyTheme(data.themeVars);
    populateSettings(data.settings);
    loadHistory(data.history || []);
    if (data.providers && data.providers.length > 0 && data.providers.some(p => p.isActive)) {
      if (onboardingEl) onboardingEl.style.display = 'none';
    }
  });

  api.onSettingsUpdated((data) => {
    settings = data.settings;
    applyTheme(data.themeVars);
    populateSettings(data.settings);
  });

  // ─── Theme ───
  function applyTheme(vars) {
    const root = document.documentElement;
    Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
  }

  // Theme selection
  $$('.theme-card').forEach(card => {
    card.onclick = () => {
      const theme = card.dataset.theme;
      api.updateSettings({ theme });
      $$('.theme-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
    };
  });

  // Accent selection
  $$('.accent-swatch').forEach(swatch => {
    swatch.onclick = () => {
      const color = swatch.dataset.color;
      api.updateSettings({ accentColor: color });
      $$('.accent-swatch').forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');
    };
  });

  // Font size
  const fontSizeRange = $('#fontSizeRange');
  const fontSizeLabel = $('#fontSizeLabel');
  fontSizeRange.oninput = () => {
    fontSizeLabel.textContent = fontSizeRange.value + 'px';
    api.updateSettings({ fontSize: parseInt(fontSizeRange.value) });
  };

  // Font family
  $('#fontFamilySelect').onchange = function() {
    api.updateSettings({ fontFamily: this.value });
  };

  // Temperature
  const tempRange = $('#temperatureRange');
  const tempLabel = $('#temperatureLabel');
  tempRange.oninput = () => {
    tempLabel.textContent = (tempRange.value / 100).toFixed(1);
    api.updateSettings({ temperature: tempRange.value / 100 });
  };

  // Max tokens
  $('#maxTokens').onchange = function() {
    api.updateSettings({ maxTokens: parseInt(this.value) || 4096 });
  };

  // Max iterations
  $('#maxIterations').onchange = function() {
    api.updateSettings({ maxIterations: parseInt(this.value) || 25 });
  };

  // Permission mode
  $('#permissionMode').onchange = function() {
    api.updateSettings({ permissionMode: this.value });
  };

  // Minimize to tray
  $('#minimizeToTray').onchange = function() {
    api.updateSettings({ minimizeToTray: this.checked });
  };

  // Server
  $('#enableServer').onchange = function() {
    api.updateSettings({ enableServer: this.checked });
    $('#serverPortRow').style.display = this.checked ? 'flex' : 'none';
  };

  $('#serverPort').onchange = function() {
    api.updateSettings({ serverPort: parseInt(this.value) || 18427 });
  };

  function populateSettings(s) {
    fontSizeRange.value = s.fontSize || 13;
    fontSizeLabel.textContent = (s.fontSize || 13) + 'px';
    tempRange.value = (s.temperature || 0.7) * 100;
    tempLabel.textContent = (s.temperature || 0.7).toFixed(1);
    $('#maxTokens').value = s.maxTokens || 4096;
    $('#maxIterations').value = s.maxIterations || 25;
    $('#permissionMode').value = s.permissionMode || 'normal';
    $('#minimizeToTray').checked = s.minimizeToTray !== false;
    $('#enableServer').checked = s.enableServer !== false;
    $('#serverPort').value = s.serverPort || 18427;
    $('#serverPortRow').style.display = s.enableServer !== false ? 'flex' : 'none';

    // Theme highlight
    $$('.theme-card').forEach(c => c.classList.toggle('active', c.dataset.theme === (s.theme || 'dark')));
    $$('.accent-swatch').forEach(c => c.classList.toggle('active', c.dataset.color === (s.accentColor || '#b0b0b0')));
  }

  // ─── Onboarding clicks ───
  if (onboardingEl) {
    onboardingEl.onclick = (e) => {
      const step = e.target.closest('.onboarding-step');
      if (step) navigate('settings');
    };
  }

  // ─── Chat ───
  inputEl.oninput = function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 64) + 'px';
    sendBtn.disabled = !this.value.trim() || isProcessing;
  };

  inputEl.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  sendBtn.onclick = sendMessage;
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'z' && !e.shiftKey) { e.preventDefault(); api.undo(); }
    if (e.ctrlKey && e.key === 'z' && e.shiftKey) { e.preventDefault(); api.redo(); }
    if (e.ctrlKey && e.key === 'y') { e.preventDefault(); api.redo(); }
    if (e.key === 'Escape' && isProcessing) { api.cancel(); }
  });

  function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || isProcessing) return;

    inputEl.value = '';
    inputEl.style.height = 'auto';
    sendBtn.disabled = true;
    if (onboardingEl) onboardingEl.style.display = 'none';

    addBubble('user', text);
    setStatus('thinking');
    isProcessing = true;
    api.sendMessage(text);
  }

  function addBubble(role, content, msgId) {
    const bubble = document.createElement('div');
    bubble.className = 'bubble ' + role;
    if (msgId) bubble.dataset.msgId = msgId;

    const header = document.createElement('div');
    header.className = 'bubble-header';
    header.innerHTML = '<span>' + (role === 'user' ? '◆' : '⬢') + '</span> ' + role;
    bubble.appendChild(header);

    const body = document.createElement('div');
    body.className = 'bubble-body';
    body.textContent = content;
    bubble.appendChild(body);

    const footer = document.createElement('div');
    footer.className = 'bubble-footer';
    footer.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    bubble.appendChild(footer);

    messagesEl.appendChild(bubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    if (role === 'assistant') currentAssistantId = msgId;
    return bubble;
  }

  function updateBubble(msgId, content) {
    const bubble = messagesEl.querySelector('[data-msg-id="' + msgId + '"]');
    if (!bubble) return;
    const body = bubble.querySelector('.bubble-body');
    if (body) body.textContent = content;
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function setStatus(s) {
    statusEl.textContent = s;
    activityText.textContent = s.charAt(0).toUpperCase() + s.slice(1);
    activityDot.className = 'activity-dot' + (s !== 'idle' ? ' active' : '');
  }

  function showThinking(msgId) {
    const bubble = messagesEl.querySelector('[data-msg-id="' + msgId + '"]');
    if (!bubble) return;
    const body = bubble.querySelector('.bubble-body');
    if (!body) return;
    body.innerHTML = '<div class="thinking"><span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span></div>';
  }

  let toolCallCount = 0;

  function addToolCard(msgId, toolName, args, status, execId) {
    const bubble = messagesEl.querySelector('[data-msg-id="' + msgId + '"]');
    if (!bubble) return;
    const body = bubble.querySelector('.bubble-body');

    const card = document.createElement('div');
    card.className = 'tool-card';
    let html = '<div class="tool-card-header">◇ ' + toolName + ' <span style="margin-left:auto;font-size:8px;color:var(--text-muted)">' + status + '</span></div>';
    if (args) {
      html += '<div class="tool-card-body"><pre style="margin:0;font-size:8px">' + escapeHtml(JSON.stringify(args, null, 2).slice(0, 200)) + '</pre></div>';
    }
    if (execId && (status === 'success' || status === 'error')) {
      html += '<div class="tool-card-footer"><button class="revert-btn" data-exec-id="' + execId + '">↩ Revert</button></div>';
    }
    card.innerHTML = html;
    body.appendChild(card);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    const revertBtn = card.querySelector('.revert-btn');
    if (revertBtn) {
      revertBtn.onclick = function() {
        api.undo();
        this.textContent = '↻ reverted';
        this.disabled = true;
      };
    }
  }

  function escapeHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function loadHistory(history) {
    if (!history || history.length === 0) return;
    if (onboardingEl) onboardingEl.style.display = 'none';
    history.forEach(msg => {
      if (msg.role === 'user' || msg.role === 'assistant') addBubble(msg.role, msg.content);
    });
  }

  // ─── Agent events ───
  api.onAgentChunk((chunk) => {
    if (!currentAssistantId) {
      currentAssistantId = 'asst_' + Date.now();
      addBubble('assistant', '', currentAssistantId);
    }
    const bubble = messagesEl.querySelector('[data-msg-id="' + currentAssistantId + '"]');
    if (!bubble) return;
    const body = bubble.querySelector('.bubble-body');
    if (!body) return;
    const current = body.textContent || '';
    body.textContent = current + chunk;
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });

  api.onAgentToolCall((call) => {
    pendingToolExecutionId = call.id || null;
    toolCallCount++;
    if (!currentAssistantId) {
      currentAssistantId = 'asst_' + Date.now();
      addBubble('assistant', '', currentAssistantId);
    }
    addToolCard(currentAssistantId, call.name, call.arguments, 'running', null);
    setStatus('executing');
  });

  api.onAgentToolResult((result) => {
    setStatus('thinking');
  });

  api.onAgentDone(() => {
    setStatus('idle');
    isProcessing = false;
    sendBtn.disabled = false;
    currentAssistantId = null;
    toolCallCount = 0;
  });

  api.onAgentError((err) => {
    setStatus('error');
    isProcessing = false;
    sendBtn.disabled = false;
    addBubble('assistant', 'Error: ' + err);
    currentAssistantId = null;
  });

  api.onAgentState((state) => {
    setStatus(state);
  });

  // Focus input
  inputEl.focus();
})();
