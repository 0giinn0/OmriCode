(function(){
  const api = window.omricode;
  if (!api) { document.body.innerHTML = '<div style="padding:20px;color:red">Bridge not loaded</div>'; return; }

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  // ─── Drag helper (uses addEventListener, never overwrites) ───
  let _dh = null;
  function startDrag(onMove, onUp) {
    stopDrag();
    _dh = {
      move: (e) => { e.preventDefault(); onMove(e); },
      up: (e) => { stopDrag(); onUp(e); }
    };
    document.addEventListener('mousemove', _dh.move);
    document.addEventListener('mouseup', _dh.up);
  }
  function stopDrag() {
    if (!_dh) return;
    document.removeEventListener('mousemove', _dh.move);
    document.removeEventListener('mouseup', _dh.up);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    _dh = null;
  }

  let settings = {}, providers = [], isProcessing = false, currentAssistantId = null;
  let fileTreeData = [], openTabs = [], activeTabPath = null;
  let snapState = 'right-33'; // right-33, right-50, left-33, bottom, float, full, hidden
  let sidebarOpen = true, chatOpen = true;
  let editor = null, editorModel = null;
  let editorFocused = true;

  // ─── Init ───
  api.onInit((data) => {
    settings = data.settings;
    providers = data.providers;
    applyTheme(data.themeVars);
    populateSettings(data.settings);
    loadHistory(data.history || []);
    renderProviderTable();
    initMonaco();
    if (settings.workspacePath) {
      $('#workspaceLabel').textContent = settings.workspacePath.split('\\').pop() || settings.workspacePath.split('/').pop();
      loadFileTree();
    }
    if (providers.some(p => p.isActive)) $('#onboardingWizard').style.display = 'none';
  });

  api.onSettingsUpdated((data) => {
    settings = data.settings;
    applyTheme(data.themeVars);
    populateSettings(data.settings);
  });

  // ─── Monaco Editor ───
  function initMonaco() {
    if (typeof require === 'undefined') return;
    require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' } });
    require(['vs/editor/editor.main'], function() {
      monaco.editor.defineTheme('omricode-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: 'comment', foreground: '666666' },
          { token: 'keyword', foreground: 'b0b0b0' },
          { token: 'string', foreground: '999999' },
          { token: 'number', foreground: 'cccccc' },
          { token: 'type', foreground: 'b0b0b0' },
          { token: 'function', foreground: 'd0d0d0' },
        ],
        colors: {
          'editor.background': '#0a0a0a',
          'editor.foreground': '#d0d0d0',
          'editor.lineHighlightBackground': '#111111',
          'editorCursor.foreground': '#b0b0b0',
          'editor.selectionBackground': '#242424',
          'editorLineNumber.foreground': '#333333',
          'editorLineNumber.activeForeground': '#666666',
          'editor.selectionHighlightBackground': '#1a1a1a',
          'editorBracketMatch.background': '#1a1a1a',
          'editorBracketMatch.border': '#333333',
          'scrollbarSlider.background': '#222222',
          'scrollbarSlider.hoverBackground': '#333333',
          'scrollbarSlider.activeBackground': '#444444',
        }
      });
      monaco.editor.setTheme('omricode-dark');
      editor = monaco.editor.create(document.getElementById('editorContainer'), {
        value: '',
        language: 'plaintext',
        fontSize: settings.fontSize || 13,
        fontFamily: (settings.fontFamily || "'SF Mono','Fira Code','Cascadia Code',monospace").replace(/'/g, ''),
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        lineNumbers: 'on',
        renderLineHighlight: 'line',
        cursorBlinking: 'smooth',
        cursorSmoothCaretAnimation: 'on',
        smoothScrolling: true,
        padding: { top: 8 },
        automaticLayout: true,
        tabSize: 2,
        theme: 'omricode-dark',
        bracketPairColorization: { enabled: true },
        guides: { indentation: true, bracketPairs: true },
      });
      editor.onDidChangeCursorPosition((e) => {
        $('#statusCursor').textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
      });
      editor.onDidFocusEditorText(() => { editorFocused = true; });
      editor.onDidBlurEditorText(() => { editorFocused = false; });
    });
  }

  function openFileInEditor(filePath, content) {
    if (!editor) return;
    $('#editorWelcome').classList.add('hidden');
    activeTabPath = filePath;
    const lang = getMonacoLanguage(filePath);
    if (editorModel) {
      if (content !== undefined) {
        editorModel.setValue(content);
      }
      monaco.editor.setModelLanguage(editorModel, lang);
    } else {
      editorModel = monaco.editor.createModel(content || '', lang);
      editor.setModel(editorModel);
    }
    const fileName = filePath.split('\\').pop() || filePath.split('/').pop();
    renderEditorTabs();
    $('#statusLang').textContent = lang.charAt(0).toUpperCase() + lang.slice(1);
  }

  function getMonacoLanguage(fp) {
    const ext = fp.split('.').pop().toLowerCase();
    const map = {
      js:'javascript',jsx:'javascript',ts:'typescript',tsx:'typescript',
      py:'python',rs:'rust',go:'go',rb:'ruby',php:'php',
      java:'java',kt:'kotlin',swift:'swift',dart:'dart',
      c:'c',cpp:'cpp',h:'c',hpp:'cpp',cs:'csharp',
      html:'html',css:'css',scss:'scss',sass:'scss',
      json:'json',xml:'xml',yaml:'yaml',yml:'yaml',
      md:'markdown',sql:'sql',sh:'shell',ps1:'powershell',
      bat:'batch',gd:'gdscript',lua:'lua',vue:'html',
      svelte:'html',env:'ini',toml:'ini',
    };
    return map[ext] || 'plaintext';
  }

  function renderEditorTabs() {
    const tabsEl = $('#editorTabs');
    if (!openTabs.length) { tabsEl.innerHTML = ''; return; }
    tabsEl.innerHTML = openTabs.map(p => {
      const name = p.split('\\').pop() || p.split('/').pop();
      return `<span class="editor-tab${p === activeTabPath ? ' active' : ''}" data-path="${p}">${name}<span class="tab-close" data-path="${p}">✕</span></span>`;
    }).join('');
    tabsEl.querySelectorAll('.editor-tab').forEach(el => {
      el.onclick = (e) => {
        if (e.target.classList.contains('tab-close')) return;
        const p = el.dataset.path;
        activeTabPath = p;
        loadFileIntoEditor(p);
        renderEditorTabs();
      };
    });
    tabsEl.querySelectorAll('.tab-close').forEach(el => {
      el.onclick = (e) => {
        e.stopPropagation();
        const p = el.dataset.path;
        openTabs = openTabs.filter(t => t !== p);
        if (activeTabPath === p) {
          activeTabPath = openTabs.length ? openTabs[openTabs.length - 1] : null;
          if (activeTabPath) loadFileIntoEditor(activeTabPath);
          else { editorModel = null; if (editor) editor.setValue(''); $('#editorWelcome').classList.remove('hidden'); }
        }
        renderEditorTabs();
      };
    });
  }

  async function loadFileIntoEditor(filePath) {
    try {
      const resp = await fetch(`http://127.0.0.1:${settings.serverPort || 18427}/files/preview?path=${encodeURIComponent(filePath)}`);
      if (!resp.ok) throw new Error('Failed');
      const data = await resp.json();
      openFileInEditor(filePath, data.content);
    } catch { /* ignore */ }
  }

  // ─── File Explorer ───
  async function loadFileTree() {
    const wp = settings.workspacePath || '';
    if (!wp) {
      $('#filesTree').style.display = 'none';
      $('#sidebarPlaceholder').style.display = 'block';
      return;
    }
    $('#sidebarPlaceholder').style.display = 'none';
    $('#filesTree').style.display = 'block';
    try {
      const resp = await fetch(`http://127.0.0.1:${settings.serverPort || 18427}/files/tree?path=${encodeURIComponent(wp)}`);
      if (!resp.ok) throw new Error('Server error');
      fileTreeData = await resp.json();
      renderFileTree(fileTreeData);
    } catch {
      $('#filesTree').innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:10px">Server unavailable</div>';
    }
  }

  function renderFileTree(items, container) {
    const el = container || $('#filesTree');
    el.innerHTML = '';
    const ul = document.createElement('div');
    renderTreeLevel(items, ul, 0);
    el.appendChild(ul);
  }

  function renderTreeLevel(items, parent, depth) {
    if (!items || !items.length) return;
    items.forEach(item => {
      const isDir = item.type === 'dir';
      const div = document.createElement('div');
      div.className = 'file-item' + (isDir ? ' dir' : '');
      div.style.paddingLeft = (8 + depth * 12) + 'px';
      const expand = document.createElement('span');
      expand.className = 'file-expand';
      expand.textContent = isDir ? (item.expanded ? '▼' : '▶') : '';
      div.appendChild(expand);
      const icon = document.createElement('span');
      icon.className = 'file-icon';
      icon.textContent = isDir ? '📁' : getFileIcon(item.name);
      div.appendChild(icon);
      const name = document.createElement('span');
      name.className = 'file-name';
      name.textContent = item.name;
      div.appendChild(name);
      parent.appendChild(div);
      if (isDir && item.expanded && item.children) {
        const cc = document.createElement('div');
        cc.className = 'file-children';
        parent.appendChild(cc);
        renderTreeLevel(item.children, cc, depth + 1);
      }
      div.onclick = () => {
        if (isDir) {
          item.expanded = !item.expanded;
          renderFileTree(fileTreeData);
        } else {
          $$('.file-item').forEach(el => el.classList.remove('selected'));
          div.classList.add('selected');
          const fullPath = item.path || item.name;
          if (!openTabs.includes(fullPath)) openTabs.push(fullPath);
          loadFileIntoEditor(fullPath);
        }
      };
    });
  }

  function getFileIcon(name) {
    const ext = name.split('.').pop().toLowerCase();
    const icons = {
      js:'📜',ts:'📘',py:'🐍',gd:'🎮',rs:'🦀',
      json:'📋',yml:'⚙',yaml:'⚙',md:'📝',html:'🌐',
      css:'🎨',scss:'🎨',sql:'🗃',sh:'💻',ps1:'💻',
      c:'⚡',cpp:'⚡',h:'⚡',java:'☕',go:'🔵',
      rb:'💎',php:'🐘',swift:'🟠',kt:'🟣',dart:'🎯',
      lua:'🌙',vue:'🟩',svelte:'🟠',jsx:'⚛',tsx:'⚛',
      toml:'⚙',lock:'🔒',env:'🔑',gitignore:'🙈',
      dockerfile:'🐳',xml:'📰'
    };
    return icons[ext] || '📄';
  }

  // ─── Snap Zones ───
  const snapPositions = ['right-33', 'right-50', 'left-33', 'bottom', 'float', 'full', 'hidden'];

  function createSnapOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'snap-overlay';
    overlay.id = 'snapOverlay';
    overlay.style.display = 'none';
    document.body.appendChild(overlay);
    const zones = ['right-50', 'right-33', 'left-33', 'bottom', 'full', 'float'];
    zones.forEach(z => {
      const zone = document.createElement('div');
      zone.className = `snap-zone snap-${z}`;
      zone.dataset.snap = z;
      zone.id = `snap-${z}`;
      overlay.appendChild(zone);
    });
  }

  $('#chatToggle').onclick = () => {
    chatOpen = !chatOpen;
    $('#ideChat').classList.toggle('collapsed', !chatOpen);
    $('#chatToggle').textContent = chatOpen ? '▶' : '◀';
  };

  $('#sidebarClose').onclick = () => {
    sidebarOpen = !sidebarOpen;
    $('#ideSidebar').classList.toggle('collapsed', !sidebarOpen);
    $('#sidebarClose').textContent = sidebarOpen ? '◀' : '▶';
  };

  // Snap via right-click menu or header drag
  const chatHeader = $('.chat-header');
  chatHeader.onmousedown = (e) => {
    if (e.button !== 0) return;
    const overlay = $('#snapOverlay');
    overlay.style.display = 'block';
    $$('.snap-zone').forEach(z => z.classList.add('active'));
    startDrag(
      (e) => {
        $$('.snap-zone').forEach(z => {
          const rect = z.getBoundingClientRect();
          const hover = e.clientX >= rect.left && e.clientX <= rect.right &&
                        e.clientY >= rect.top && e.clientY <= rect.bottom;
          z.classList.toggle('hover', hover);
        });
      },
      (e) => {
        const overlay = $('#snapOverlay');
        overlay.style.display = 'none';
        let snapped = null;
        $$('.snap-zone').forEach(z => {
          z.classList.remove('active', 'hover');
          const rect = z.getBoundingClientRect();
          if (e.clientX >= rect.left && e.clientX <= rect.right &&
              e.clientY >= rect.top && e.clientY <= rect.bottom) {
            snapped = z.dataset.snap;
          }
        });
        if (snapped) applySnap(snapped);
      }
    );
  };

  function applySnap(pos) {
    snapState = pos;
    chatOpen = true;
    const chat = $('#ideChat');
    chat.classList.remove('collapsed');
    switch (pos) {
      case 'right-50': chat.style.width = '50%'; break;
      case 'right-33': chat.style.width = 'var(--chat-w)'; break;
      case 'left-33':
        chat.style.width = '33%';
        $('#ideBody').style.flexDirection = 'row-reverse';
        break;
      case 'bottom':
        chat.style.position = 'absolute';
        chat.style.bottom = 'var(--statusbar-h)';
        chat.style.left = '0';
        chat.style.right = '0';
        chat.style.height = '40%';
        chat.style.width = '100%';
        chat.style.zIndex = '10';
        chat.style.borderLeft = 'none';
        chat.style.borderTop = '1px solid var(--border)';
        break;
      case 'float':
        chat.style.position = 'fixed';
        chat.style.width = '400px';
        chat.style.height = '500px';
        chat.style.bottom = 'calc(var(--statusbar-h) + 20px)';
        chat.style.right = '20px';
        chat.style.zIndex = '50';
        chat.style.boxShadow = '0 20px 60px rgba(0,0,0,0.5)';
        chat.style.borderRadius = 'var(--radius)';
        chat.style.border = '1px solid var(--border)';
        break;
      case 'full':
        chat.style.position = 'fixed';
        chat.style.inset = 'var(--titlebar-h) 0 var(--statusbar-h)';
        chat.style.width = '100%';
        chat.style.zIndex = '10';
        chat.style.borderLeft = 'none';
        break;
      case 'hidden':
        chat.classList.add('collapsed');
        chatOpen = false;
        chat.style.position = '';
        $('#chatToggle').textContent = '◀';
        break;
    }
  }

  // ─── Panel Swap (Blender-like) ───
  const panelSlots = [
    { id: 'ideSidebar', label: 'EXPLORER' },
    { id: 'ideEditor', label: 'EDITOR' },
    { id: 'ideChat', label: 'CHAT' },
  ];
  const swapOverlay = document.createElement('div');
  swapOverlay.id = 'swapOverlay';
  swapOverlay.style.cssText = 'position:fixed;inset:0;z-index:997;display:none';
  document.body.appendChild(swapOverlay);

  function getPanelEl(slot) { return document.getElementById(slot.id); }

  function getHeaderEl(slot) {
    const el = getPanelEl(slot);
    return el ? el.querySelector('.sidebar-header, .editor-toolbar, .chat-header') : null;
  }

  // Make each panel header a drag source for swapping
  panelSlots.forEach((slot, idx) => {
    const header = getHeaderEl(slot);
    if (!header) return;
    header.style.cursor = 'grab';
    header.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.target.closest('button, .tb-btn, input, textarea, select')) return;
      const bodyRect = document.querySelector('.ide-body').getBoundingClientRect();
      const targets = [];
      panelSlots.forEach((otherSlot, oIdx) => {
        if (oIdx === idx) return;
        const otherEl = getPanelEl(otherSlot);
        if (!otherEl) return;
        const r = otherEl.getBoundingClientRect();
        const zone = document.createElement('div');
        zone.className = 'swap-zone';
        Object.assign(zone.style, {
          position: 'fixed', zIndex: '998', pointerEvents: 'none',
          left: r.left + 'px', top: r.top + 'px',
          width: r.width + 'px', height: r.height + 'px',
          border: '2px dashed var(--accent)', borderRadius: 'var(--radius-lg)',
          background: 'rgba(176,176,176,0.06)', opacity: '0',
          transition: 'opacity 0.15s, background 0.15s',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '10px', color: 'var(--accent)', textTransform: 'uppercase',
          letterSpacing: '0.05em'
        });
        zone.textContent = '⇄ ' + otherSlot.label;
        zone.dataset.targetIdx = oIdx;
        swapOverlay.appendChild(zone);
        targets.push(zone);
      });
      swapOverlay.style.display = 'block';
      requestAnimationFrame(() => targets.forEach(t => t.style.opacity = '1'));

      startDrag(
        (e) => {
          targets.forEach(t => {
            const r = t.getBoundingClientRect();
            const hover = e.clientX >= r.left && e.clientX <= r.right &&
                          e.clientY >= r.top && e.clientY <= r.bottom;
            t.style.background = hover ? 'rgba(176,176,176,0.15)' : 'rgba(176,176,176,0.06)';
            t.style.borderColor = hover ? 'var(--accent)' : 'var(--accent)';
          });
        },
        (e) => {
          swapOverlay.style.display = 'none';
          let targetIdx = null;
          targets.forEach(t => {
            const r = t.getBoundingClientRect();
            if (e.clientX >= r.left && e.clientX <= r.right &&
                e.clientY >= r.top && e.clientY <= r.bottom) {
              targetIdx = parseInt(t.dataset.targetIdx);
            }
            t.remove();
          });
          if (targetIdx !== null && targetIdx !== idx) {
            doPanelSwap(idx, targetIdx);
          }
        }
      );
    });
  });

  function doPanelSwap(aIdx, bIdx) {
    if (aIdx === bIdx) return;
    const parent = document.querySelector('.ide-body');
    const panels = panelSlots.map(s => getPanelEl(s));
    const children = [...parent.children];
    const frag = document.createDocumentFragment();
    children.forEach(child => {
      if (child === panels[aIdx]) {
        frag.appendChild(panels[bIdx]);
      } else if (child === panels[bIdx]) {
        frag.appendChild(panels[aIdx]);
      } else {
        frag.appendChild(child);
      }
    });
    parent.innerHTML = '';
    parent.appendChild(frag);
  }

  // ─── Keyboard shortcuts ───
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'z' && !e.shiftKey && !editorFocused) { e.preventDefault(); api.undo(); }
    if (e.ctrlKey && e.key === 'z' && e.shiftKey) { e.preventDefault(); api.redo(); }
    if (e.ctrlKey && e.key === 'y') { e.preventDefault(); api.redo(); }
    if (e.key === 'Escape' && isProcessing) { api.cancel(); }
    if (e.ctrlKey && e.key === 'b') { e.preventDefault(); sidebarOpen = !sidebarOpen; $('#ideSidebar').classList.toggle('collapsed', !sidebarOpen); }
    if (e.ctrlKey && e.key === 'j') { e.preventDefault(); chatOpen = !chatOpen; $('#ideChat').classList.toggle('collapsed', !chatOpen); }
  });

  // ─── Window controls ───
  $('#btnMinimize').onclick = () => api.minimize();
  $('#btnMaximize').onclick = () => api.maximize();
  $('#btnClose').onclick = () => api.close();
  $('#navSettings').onclick = () => { $('#settingsModal').style.display = 'flex'; };
  $('#settingsClose').onclick = () => { $('#settingsModal').style.display = 'none'; };

  // ─── Folder picker ───
  const workspacePathEl = $('#workspacePath');
  $('#selectFolderBtn').onclick = async () => {
    const folder = await api.selectFolder();
    if (folder) {
      workspacePathEl.value = folder;
      settings.workspacePath = folder;
      $('#workspaceLabel').textContent = folder.split('\\').pop() || folder.split('/').pop();
      loadFileTree();
    }
  };

  // ─── Sidebar open settings ───
  $('#sidebarOpenSettings').onclick = () => { $('#settingsModal').style.display = 'flex'; };

  // ─── Welcome actions ───
  $('#welcomeOpenFolder').onclick = async () => {
    const folder = await api.selectFolder();
    if (folder) {
      settings.workspacePath = folder;
      $('#workspaceLabel').textContent = folder.split('\\').pop() || folder.split('/').pop();
      loadFileTree();
    }
  };
  $('#welcomeNewFile').onclick = () => {
    if (!editor) return;
    $('#editorWelcome').classList.add('hidden');
    openFileInEditor('untitled', '');
  };
  $('#welcomeChat').onclick = () => { $('#chatInput').focus(); };

  // ─── Provider Table ───
  const providerTableBody = $('#providerTableBody');

  async function loadProviders() {
    providers = await api.getProviders();
    renderProviderTable();
  }

  function renderProviderTable() {
    providerTableBody.innerHTML = '';
    providers.forEach((p) => {
      const tr = document.createElement('tr');
      if (p.isActive) tr.className = 'active';
      tr.innerHTML = `
        <td><input type="radio" name="ap" value="${p.id}" class="pr" ${p.isActive ? 'checked' : ''}></td>
        <td><input type="text" value="${esc(p.name)}" class="pv-name" data-id="${p.id}"></td>
        <td><input type="text" value="${esc(p.endpoint)}" class="pv-ep" data-id="${p.id}"></td>
        <td style="display:flex;align-items:center;gap:2px">
          <input type="text" value="${esc(p.model)}" class="pv-model" data-id="${p.id}" style="flex:1;min-width:50px">
          <button class="pv-detect" data-id="${p.id}" title="Auto-detect models">⟳</button>
        </td>
        <td><input type="password" value="${esc(p.apiKey)}" class="pv-key" data-id="${p.id}"></td>
        <td style="font-size:9px;color:${p.supportsFC === true ? 'var(--success)' : p.supportsFC === 'auto' ? 'var(--accent)' : 'var(--text-muted)'}">${p.supportsFC === true ? '✓' : p.supportsFC === 'auto' ? '?' : '✕'}</td>
        <td><button class="pv-remove" data-id="${p.id}">✕</button></td>`;
      providerTableBody.appendChild(tr);
    });
    providerTableBody.querySelectorAll('.pr').forEach(r => { r.onchange = async function() { await api.setActiveProvider(this.value); loadProviders(); }; });
    const onEdit = (cls, field) => { providerTableBody.querySelectorAll('.' + cls).forEach(el => { el.onchange = function() { api.updateProvider(this.dataset.id, { [field]: this.value }); }; }); };
    onEdit('pv-name', 'name'); onEdit('pv-ep', 'endpoint'); onEdit('pv-model', 'model'); onEdit('pv-key', 'apiKey');
    providerTableBody.querySelectorAll('.pv-remove').forEach(btn => { btn.onclick = function() { api.removeProvider(this.dataset.id); loadProviders(); }; });

    // Auto-detect models
    providerTableBody.querySelectorAll('.pv-detect').forEach(btn => {
      btn.onclick = async function() {
        const id = this.dataset.id;
        this.textContent = '⋯';
        const result = await api.detectModels(id);
        this.textContent = '⟳';
        if (result.success && result.models && result.models.length) {
          const modelInput = document.querySelector(`.pv-model[data-id="${id}"]`);
          if (modelInput) {
            modelInput.value = result.models[0];
            api.updateProvider(id, { model: result.models[0] });
            loadProviders();
          }
        }
      };
    });

    const active = providers.find(p => p.isActive);
    $('#statusProvider').textContent = active ? `${active.name}:${active.model || '?'}` : 'No provider';
    renderModelScroll(active);
  }

  function renderModelScroll(active) {
    const scroll = $('#modelScroll');
    scroll.innerHTML = '';
    if (!active) { scroll.innerHTML = '<span style="font-size:9px;color:var(--text-muted)">No provider</span>'; return; }
    // Provider chip
    const prov = document.createElement('span');
    prov.className = 'model-chip provider';
    prov.textContent = active.name;
    scroll.appendChild(prov);
    // Model chips
    const models = active.detectedModels && active.detectedModels.length ? active.detectedModels : (active.model ? [active.model] : []);
    models.forEach(m => {
      if (!m) return;
      const chip = document.createElement('span');
      chip.className = 'model-chip' + (m === active.model ? ' active' : '');
      chip.textContent = m;
      chip.onclick = async () => {
        await api.updateProvider(active.id, { model: m });
        loadProviders();
      };
      scroll.appendChild(chip);
    });
    // Scroll buttons
    if (models.length > 2) {
      const leftBtn = document.createElement('button');
      leftBtn.className = 'model-scroll-btn';
      leftBtn.textContent = '◀';
      leftBtn.onclick = () => { scroll.scrollBy({ left: -120, behavior: 'smooth' }); };
      const rightBtn = document.createElement('button');
      rightBtn.className = 'model-scroll-btn';
      rightBtn.textContent = '▶';
      rightBtn.onclick = () => { scroll.scrollBy({ left: 120, behavior: 'smooth' }); };
      scroll.parentNode.insertBefore(leftBtn, scroll);
      scroll.parentNode.appendChild(rightBtn);
    }
    setTimeout(() => { scroll.scrollLeft = scroll.scrollWidth; }, 50);
  }

  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  const KNOWN_PROVIDERS = [
    { name: 'OpenAI', endpoint: 'https://api.openai.com/v1', models: 'gpt-4o, gpt-4, gpt-3.5-turbo', fc: true },
    { name: 'Anthropic', endpoint: 'https://api.anthropic.com/v1', models: 'claude-3-5-sonnet, claude-3-opus', fc: true },
    { name: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1', models: '200+ models', fc: true },
    { name: 'Groq', endpoint: 'https://api.groq.com/openai/v1', models: 'mixtral, llama, gemma', fc: true },
    { name: 'DeepSeek', endpoint: 'https://api.deepseek.com/v1', models: 'deepseek-chat, deepseek-coder', fc: true },
    { name: 'Together AI', endpoint: 'https://api.together.xyz/v1', models: 'llama, mixtral, deepseek', fc: true },
    { name: 'Mistral', endpoint: 'https://api.mistral.ai/v1', models: 'mistral-large, mistral-small', fc: true },
    { name: 'Perplexity', endpoint: 'https://api.perplexity.ai', models: 'sonar, sonar-pro', fc: false },
    { name: 'xAI (Grok)', endpoint: 'https://api.x.ai/v1', models: 'grok-beta, grok-2', fc: true },
    { name: 'Google (Gemini)', endpoint: 'https://generativelanguage.googleapis.com/v1beta/models', models: 'gemini-1.5-pro, gemini-1.5-flash', fc: true },
    { name: 'Ollama (Local)', endpoint: 'http://localhost:11434/v1', models: 'nous-hermes, llama3, qwen', fc: true },
    { name: 'LM Studio (Local)', endpoint: 'http://localhost:1234/v1', models: 'any OpenAI-compatible', fc: 'auto' },
    { name: 'Custom', endpoint: '', models: 'any', fc: 'auto' },
  ];

  function showProviderPicker() {
    const list = $('#providerPickerList');
    list.innerHTML = KNOWN_PROVIDERS.map(p => `
      <div class="provider-option" data-endpoint="${esc(p.endpoint)}" data-name="${esc(p.name)}" data-fc="${p.fc}">
        <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:var(--radius);border:1px solid var(--border);cursor:pointer;background:var(--surface);transition:all var(--ease)">
          <div style="flex:1">
            <div style="font-size:11px;color:var(--text);font-weight:500">${p.name}</div>
            <div style="font-size:9px;color:var(--text-muted)">${p.endpoint || 'Custom endpoint'}</div>
          </div>
          <div style="font-size:9px;color:var(--text-muted);text-align:right">
            <div>${p.models}</div>
            <div style="color:${p.fc === true ? 'var(--success)' : 'var(--text-muted)'}">FC: ${p.fc === true ? '✓' : p.fc === 'auto' ? '?' : '✕'}</div>
          </div>
        </div>
      </div>
    `).join('');
    list.querySelectorAll('.provider-option').forEach(el => {
      el.onclick = async () => {
        const name = el.dataset.name;
        const endpoint = el.dataset.endpoint;
        const supportsFC = el.dataset.fc === 'true' ? true : el.dataset.fc === 'auto' ? 'auto' : false;
        await api.addProvider({
          id: crypto.randomUUID(), name, endpoint, model: '', apiKey: '',
          isActive: false, supportsFC, maxTokens: 4096, temperature: 0.7, order: Date.now()
        });
        $('#providerPickerModal').style.display = 'none';
        loadProviders();
      };
    });
    $('#providerPickerModal').style.display = 'flex';
    $('#providerPickerModal').classList.add('top');
  }

  $('#addProviderBtn').onclick = showProviderPicker;
  $('#providerPickerClose').onclick = () => { $('#providerPickerModal').style.display = 'none'; $('#providerPickerModal').classList.remove('top'); };

  // ─── Draggable Modals ───
  function makeDraggable(modalEl) {
    const header = modalEl.querySelector('.modal-header');
    let startX, startY, origX, origY;
    header.onmousedown = (e) => {
      if (e.target.closest('button')) return;
      const rect = modalEl.getBoundingClientRect();
      origX = rect.left; origY = rect.top;
      startX = e.clientX; startY = e.clientY;
      modalEl.style.position = 'fixed';
      modalEl.style.margin = '0';
      modalEl.style.left = origX + 'px';
      modalEl.style.top = origY + 'px';
      startDrag(
        (e) => {
          modalEl.style.left = (origX + e.clientX - startX) + 'px';
          modalEl.style.top = (origY + e.clientY - startY) + 'px';
        },
        () => {}
      );
    };
  }
  makeDraggable($('#settingsModal'));
  makeDraggable($('#providerPickerModal'));

  // ─── Theme ───
  function applyTheme(vars) {
    const root = document.documentElement;
    if (vars) Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
  }

  $$('.theme-circle').forEach(circle => { circle.onclick = () => { api.updateSettings({ theme: circle.dataset.theme }); $$('.theme-circle').forEach(c => c.classList.toggle('active', c === circle)); }; });
  $$('.accent-swatch').forEach(swatch => { swatch.onclick = () => { api.updateSettings({ accentColor: swatch.dataset.color }); $$('.accent-swatch').forEach(s => s.classList.toggle('active', s === swatch)); }; });

  const fontSizeRange = $('#fontSizeRange'), fontSizeLabel = $('#fontSizeLabel');
  fontSizeRange.oninput = () => { fontSizeLabel.textContent = fontSizeRange.value + 'px'; api.updateSettings({ fontSize: parseInt(fontSizeRange.value) }); if (editor) editor.updateOptions({ fontSize: parseInt(fontSizeRange.value) }); };
  $('#fontFamilySelect').onchange = function() { api.updateSettings({ fontFamily: this.value }); if (editor) editor.updateOptions({ fontFamily: this.value.replace(/'/g, '') }); };
  $('#agentDefaults').onchange = function() { api.updateSettings({ agentDefaults: this.value }); };
  $('#permissionMode').onchange = function() { api.updateSettings({ permissionMode: this.value }); };
  $('#minimizeToTray').onchange = function() { api.updateSettings({ minimizeToTray: this.checked }); };
  $('#enableServer').onchange = function() { api.updateSettings({ enableServer: this.checked }); $('#serverPortRow').style.display = this.checked ? 'flex' : 'none'; };
  $('#serverPort').onchange = function() { api.updateSettings({ serverPort: parseInt(this.value) || 18427 }); };

  function populateSettings(s) {
    if (!s) return;
    fontSizeRange.value = s.fontSize || 13; fontSizeLabel.textContent = (s.fontSize || 13) + 'px';
    if (workspacePathEl) workspacePathEl.value = s.workspacePath || '';
    $('#agentDefaults').value = s.agentDefaults || 'max_tokens=4096\ntemperature=0.7\nmax_iterations=25\nsystem_prompt=You are OmriCode, a helpful AI coding assistant.';
    $('#permissionMode').value = s.permissionMode || 'normal';
    $('#minimizeToTray').checked = s.minimizeToTray !== false;
    $('#enableServer').checked = s.enableServer !== false; $('#serverPort').value = s.serverPort || 18427;
    $('#serverPortRow').style.display = s.enableServer !== false ? 'flex' : 'none';
    $$('.theme-circle').forEach(c => c.classList.toggle('active', c.dataset.theme === (s.theme || 'dark')));
    $$('.accent-swatch').forEach(c => c.classList.toggle('active', c.dataset.color === (s.accentColor || '#b0b0b0')));
  }

  // ─── Chat ───
  const messagesEl = $('#messagesContainer'), inputEl = $('#chatInput'), sendBtn = $('#sendBtn');

  inputEl.oninput = function() { this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight, 64) + 'px'; sendBtn.disabled = !this.value.trim() || isProcessing; };
  inputEl.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } };
  sendBtn.onclick = sendMessage;

  function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || isProcessing) return;
    inputEl.value = ''; inputEl.style.height = 'auto'; sendBtn.disabled = true;
    if ($('#onboardingWizard')) $('#onboardingWizard').style.display = 'none';
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

  function setStatus(s) { $('#statusText').textContent = s; $('#activityDot').className = 'activity-dot' + (s !== 'idle' ? ' active' : ''); }

  let toolCallCount = 0;

  function addToolCard(msgId, toolName, args, status, execId) {
    const bubble = messagesEl.querySelector('[data-msg-id="' + msgId + '"]');
    if (!bubble) return;
    const body = bubble.querySelector('.bubble-body');
    const card = document.createElement('div');
    card.className = 'tool-card';
    let html = '<div class="tool-card-header">◇ ' + toolName + ' <span style="margin-left:auto;font-size:8px;color:var(--text-muted)">' + status + '</span></div>';
    if (args) html += '<div class="tool-card-body"><pre style="margin:0;font-size:8px">' + esc(JSON.stringify(args, null, 2).slice(0, 200)) + '</pre></div>';
    if (execId && (status === 'success' || status === 'error')) html += '<div class="tool-card-footer"><button class="revert-btn" data-exec-id="' + execId + '">↩ Revert</button></div>';
    card.innerHTML = html;
    body.appendChild(card);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    const revertBtn = card.querySelector('.revert-btn');
    if (revertBtn) { revertBtn.onclick = function() { api.undo(); this.textContent = '↻ reverted'; this.disabled = true; }; }
  }

  function loadHistory(history) {
    if (!history || history.length === 0) return;
    if ($('#onboardingWizard')) $('#onboardingWizard').style.display = 'none';
    history.forEach(msg => { if (msg.role === 'user' || msg.role === 'assistant') addBubble(msg.role, msg.content); });
  }

  // ─── Agent Events ───
  api.onAgentChunk((chunk) => {
    if (!currentAssistantId) { currentAssistantId = 'asst_' + Date.now(); addBubble('assistant', '', currentAssistantId); }
    const bubble = messagesEl.querySelector('[data-msg-id="' + currentAssistantId + '"]');
    if (!bubble) return;
    const body = bubble.querySelector('.bubble-body');
    if (!body) return;
    body.textContent = (body.textContent || '') + chunk;
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });

  api.onAgentToolCall((call) => {
    toolCallCount++;
    if (!currentAssistantId) { currentAssistantId = 'asst_' + Date.now(); addBubble('assistant', '', currentAssistantId); }
    addToolCard(currentAssistantId, call.name, call.arguments, 'running', null);
    setStatus('executing');
  });

  api.onAgentToolResult(() => { setStatus('thinking'); });
  api.onAgentDone(() => { setStatus('idle'); isProcessing = false; sendBtn.disabled = false; currentAssistantId = null; toolCallCount = 0; });
  api.onAgentError((err) => { setStatus('error'); isProcessing = false; sendBtn.disabled = false; addBubble('assistant', 'Error: ' + err); currentAssistantId = null; });
  api.onAgentState((state) => { setStatus(state); });

  // ─── Ask User ───
  api.onAskUser((data) => { const answer = prompt('OmriCode: ' + data.question); api.resolveUserPrompt(data.id, answer || ''); });
  api.onClear(() => { messagesEl.innerHTML = ''; currentAssistantId = null; });
  api.onReset(() => { messagesEl.innerHTML = ''; currentAssistantId = null; isProcessing = false; sendBtn.disabled = false; inputEl.value = ''; inputEl.style.height = 'auto'; setStatus('idle'); });

  // ─── Draggable Dividers ───
  function makeDivider(dividerId, leftId, rightId, isHorizontal) {
    const divider = $(`#${dividerId}`);
    if (!divider) return;
    let startPos = 0, startSize = 0;
    divider.onmousedown = (e) => {
      startPos = isHorizontal ? e.clientY : e.clientX;
      const left = $(`#${leftId}`);
      startSize = isHorizontal ? left.offsetHeight : left.offsetWidth;
      document.body.style.cursor = isHorizontal ? 'row-resize' : 'col-resize';
      document.body.style.userSelect = 'none';
      startDrag(
        (e) => {
          const delta = (isHorizontal ? e.clientY : e.clientX) - startPos;
          const left = $(`#${leftId}`);
          const newSize = Math.max(100, startSize + delta);
          if (isHorizontal) left.style.height = newSize + 'px';
          else left.style.width = newSize + 'px';
        },
        () => {}
      );
    };
  }
  makeDivider('dividerSidebar', 'ideSidebar', 'ideEditor', false);
  makeDivider('dividerChat', 'ideEditor', 'ideChat', false);

  // ─── Terminal ───
  let term = null, termFit = null;

  async function initTerminal() {
    if (typeof Terminal === 'undefined') return;
    const container = document.getElementById('terminalContainer');
    if (!container) return;
    if (term) { $('#terminalPanel').style.display = $('#terminalPanel').style.display === 'none' ? 'flex' : 'none'; return; }
    term = new Terminal({
      cursorBlink: true, cursorStyle: 'bar', fontSize: 12,
      fontFamily: settings.fontFamily || "'SF Mono','Fira Code','Cascadia Code',monospace",
      theme: { background: '#0a0a0a', foreground: '#d0d0d0', cursor: '#b0b0b0',
        selectionBackground: '#242424', black: '#222', red: '#e06c6c', green: '#6bb86b',
        yellow: '#e0b06c', blue: '#6c8ce0', magenta: '#ce93d8', cyan: '#6cd8e0', white: '#d0d0d0' },
      allowProposedApi: true,
    });
    const FA = window.FitAddon;
    termFit = new (FA?.FitAddon || FA || { fit() {} })();
    term.loadAddon(termFit);
    term.open(container);
    termFit.fit();
    $('#terminalPanel').style.display = 'flex';

    const result = await api.terminalStart();
    if (!result.ok) { term.write('Failed to start terminal.\r\n'); return; }

    api.onTerminalOutput((data) => { if (term) term.write(data); });

    term.onData((data) => { api.terminalInput(data); });

    term.onResize(({ cols, rows }) => { api.terminalResize(cols, rows); });

    setTimeout(() => termFit.fit(), 100);
  }

  $('#terminalToggleBtn').onclick = initTerminal;
  $('#terminalCloseBtn').onclick = () => {
    $('#terminalPanel').style.display = 'none';
    api.terminalStop();
    if (term) { term.dispose(); term = null; termFit = null; }
  };
  $('#terminalNewBtn').onclick = async () => {
    await api.terminalStop();
    if (term) term.clear();
    await api.terminalStart();
  };

  // ─── Preview ───
  $('#previewBtn').onclick = () => {
    const panel = $('#previewPanel');
    if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }
    panel.style.display = 'flex';
    // Auto-set URL to current file if HTML
    if (activeTabPath && (activeTabPath.endsWith('.html') || activeTabPath.endsWith('.htm'))) {
      $('#previewUrl').value = 'file:///' + activeTabPath.replace(/\\/g, '/');
      $('#previewIframe').src = 'file:///' + activeTabPath.replace(/\\/g, '/');
    }
  };
  $('#previewClose').onclick = () => { $('#previewPanel').style.display = 'none'; };
  $('#previewGo').onclick = () => {
    let url = $('#previewUrl').value.trim();
    if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('file:///')) url = 'https://' + url;
    $('#previewIframe').src = url;
  };
  $('#previewUrl').onkeydown = (e) => { if (e.key === 'Enter') $('#previewGo').click(); };

  // ─── Share ───
  function showShare() {
    if (!activeTabPath) return;
    const name = activeTabPath.split('\\').pop() || activeTabPath.split('/').pop();
    $('#shareFileName').textContent = name;
    const link = `file:///${activeTabPath.replace(/\\/g, '/')}`;
    $('#shareLinkInput').value = link;
    $('#shareModal').style.display = 'flex';
  }
  $('#shareBtn').onclick = showShare;
  $('#shareModalClose').onclick = () => { $('#shareModal').style.display = 'none'; };
  $('#shareCopyContent').onclick = async () => {
    if (!activeTabPath) return;
    try {
      const resp = await fetch(`http://127.0.0.1:${settings.serverPort || 18427}/files/preview?path=${encodeURIComponent(activeTabPath)}`);
      if (!resp.ok) throw new Error('Failed');
      const data = await resp.json();
      await navigator.clipboard.writeText(data.content);
      $('#shareCopyContent').textContent = '✓ Copied!';
      setTimeout(() => { $('#shareCopyContent').textContent = '📋 Copy Content'; }, 2000);
    } catch { /* ignore */ }
  };
  $('#shareCopyPath').onclick = async () => {
    await navigator.clipboard.writeText(activeTabPath);
    $('#shareCopyPath').textContent = '✓ Copied!';
    setTimeout(() => { $('#shareCopyPath').textContent = '📁 Copy File Path'; }, 2000);
  };
  $('#shareCopyLink').onclick = async () => {
    await navigator.clipboard.writeText($('#shareLinkInput').value);
    $('#shareCopyLink').textContent = '✓ Copied!';
    setTimeout(() => { $('#shareCopyLink').textContent = 'Copy'; }, 2000);
  };

  // ─── Show toolbar when file is open ───
  const origOpenFile = openFileInEditor;
  openFileInEditor = function(filePath, content) {
    origOpenFile(filePath, content);
    $('#editorToolbar').style.display = 'flex';
    if (filePath && filePath !== 'untitled') {
      $('#previewBtn').style.display = filePath.endsWith('.html') || filePath.endsWith('.htm') ? 'inline-flex' : 'none';
    }
  };

  // ─── Init Snap Overlay ───
  createSnapOverlay();

  // ─── Focus input ───
  setTimeout(() => inputEl.focus(), 500);
})();