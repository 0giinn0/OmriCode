/**
 * ChatPanel.ts
 * OmriCode — VS Code WebView Chat Panel
 *
 * The primary UI for the OmriCode agent. Renders as a sidebar WebView
 * with glass morph styling, adjustable snap zones, and responsive
 * bubble-based chat display.
 *
 * Manages:
 *   - WebView panel lifecycle (create, reveal, dispose)
 *   - Message posting between extension host and WebView
 *   - Provider table inline editing
 *   - Onboarding wizard (first-run)
 *   - Panel snap with drag-to-snap zones
 */

import * as vscode from 'vscode';
import { ConfigManager } from '../config/ConfigManager';
import { ProviderTable } from '../config/ProviderTable';
import { AgentLoop } from '../agent/AgentLoop';
import { PanelSnap, SnapZone } from './PanelSnap';

export class ChatPanel implements vscode.Disposable {
  private context: vscode.ExtensionContext;
  private agentLoop: AgentLoop;
  private configManager: ConfigManager;
  private panelSnap: PanelSnap;
  private panel: vscode.WebviewPanel | null = null;
  private disposables: vscode.Disposable[] = [];

  constructor(
    context: vscode.ExtensionContext,
    agentLoop: AgentLoop,
    configManager: ConfigManager
  ) {
    this.context = context;
    this.agentLoop = agentLoop;
    this.configManager = configManager;
    this.panelSnap = new PanelSnap(configManager);
  }

  /**
   * Initialize the chat panel (lazy — doesn't create WebView until first open).
   */
  initialize(): void {
    // Register agent callbacks for WebView communication
    this.agentLoop.setCallbacks({
      onMessageStart: (messageId) => {
        this.postMessage({ type: 'messageStart', payload: { messageId } });
      },
      onChunk: (messageId, chunk) => {
        this.postMessage({ type: 'messageChunk', payload: { messageId, chunk } });
      },
      onToolCallStart: (messageId, toolCall) => {
        this.postMessage({
          type: 'toolCallStart',
          payload: { messageId, toolCall }
        });
      },
      onToolCallComplete: (messageId, toolCall, result) => {
        this.postMessage({
          type: 'toolCallComplete',
          payload: { messageId, toolCall, result }
        });
      },
      onMessageComplete: (messageId) => {
        this.postMessage({ type: 'messageComplete', payload: { messageId } });
      },
      onError: (messageId, error) => {
        this.postMessage({ type: 'messageError', payload: { messageId, error } });
      },
      onStateChange: (state) => {
        this.postMessage({ type: 'stateChange', payload: { state } });
      },
      onPermissionRequest: async (toolName, args, description) => {
        return new Promise(resolve => {
          this.postMessage({
            type: 'permissionRequest',
            payload: { toolName, args, description, requestId: crypto.randomUUID() }
          });
          // Response comes back via onDidReceiveMessage
          this.resolvePermission = resolve;
        });
      }
    });

    // Register panel snap state changes
    this.panelSnap.onDidChangeState((state) => {
      this.postMessage({
        type: 'snapChanged',
        payload: { zone: state.zone, cssProps: this.panelSnap.getCSSProperties() }
      });
    });
  }

  private resolvePermission: ((approved: boolean) => void) | null = null;

  /**
   * Create or reveal the chat panel.
   */
  reveal(): void {
    if (this.panel) {
      this.panel.reveal(this.panel.viewColumn);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'omricode.chat',
      'OmriCode',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, 'webview'),
          vscode.Uri.joinPath(this.context.extensionUri, 'src', 'ui', 'styles')
        ]
      }
    );

    this.panel.webview.html = this.getWebviewContent();
    this.panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'icon.png');

    // Handle messages from WebView
    this.disposables.push(
      this.panel.webview.onDidReceiveMessage(this.handleWebViewMessage.bind(this))
    );

    // Cleanup on panel dispose
    this.disposables.push(
      this.panel.onDidDispose(() => {
        this.panel = null;
      })
    );
  }

  /**
   * Toggle panel visibility using snap system.
   */
  toggle(): void {
    if (this.panel) {
      this.panelSnap.toggleVisibility();
      if (this.panelSnap.getZone() === 'hidden') {
        this.panel.dispose();
        this.panel = null;
      }
    } else {
      this.reveal();
    }
  }

  /**
   * Send a user message to the agent loop (from non-UI code).
   */
  sendUserMessage(text: string): void {
    this.reveal();
    this.postMessage({ type: 'userMessage', payload: { text } });
    this.agentLoop.processUserMessage(text);
  }

  /**
   * Post a message to the WebView.
   */
  postMessage(message: Record<string, unknown>): void {
    this.panel?.webview.postMessage(message);
  }

  /**
   * Handle incoming messages from the WebView.
   */
  private async handleWebViewMessage(message: Record<string, unknown>): Promise<void> {
    const type = message.type as string;
    const payload = message.payload as Record<string, unknown> || {};

    switch (type) {
      case 'userMessage':
        const text = payload.text as string;
        if (text && text.trim()) {
          this.agentLoop.processUserMessage(text.trim());
        }
        break;

      case 'permissionResponse':
        const approved = payload.approved as boolean;
        if (this.resolvePermission) {
          this.resolvePermission(approved);
          this.resolvePermission = null;
        }
        break;

      case 'snapTo':
        const zone = payload.zone as SnapZone;
        if (zone) this.panelSnap.snapTo(zone);
        break;

      case 'toggleVisibility':
        this.toggle();
        break;

      case 'cancelRequest':
        this.agentLoop.cancel();
        break;

      case 'getProviders':
        const providers = this.configManager.getProviders();
        this.postMessage({
          type: 'providersUpdate',
          payload: { providers }
        });
        break;

      case 'addProvider':
        const newProvider = payload.provider as Record<string, unknown>;
        if (newProvider) {
          const table = new ProviderTable(this.configManager);
          table.add(newProvider as any);
        }
        break;

      case 'updateProvider':
        const providerId = payload.providerId as string;
        const updates = payload.updates as Record<string, unknown>;
        if (providerId && updates) {
          this.configManager.updateProvider(providerId, updates);
        }
        break;

      case 'removeProvider':
        const removeId = payload.providerId as string;
        if (removeId) {
          this.configManager.removeProvider(removeId);
        }
        break;

      case 'setActiveProvider':
        const activeId = payload.providerId as string;
        if (activeId) {
          this.configManager.setActiveProvider(activeId);
        }
        break;

      case 'testProvider':
        const testId = payload.providerId as string;
        if (testId) {
          const provider = this.configManager.getProviders().find(p => p.id === testId);
          if (provider) {
            const table = new ProviderTable(this.configManager);
            const result = await table.testConnection(provider);
            this.postMessage({
              type: 'providerTestResult',
              payload: { providerId: testId, result }
            });
          }
        }
        break;

      case 'resetConfig':
        this.configManager.clearWorkspaceState();
        break;

      case 'webviewReady':
        // WebView initialized — send current state
        this.postMessage({
          type: 'snapChanged',
          payload: {
            zone: this.panelSnap.getZone(),
            cssProps: this.panelSnap.getCSSProperties()
          }
        });
        this.postMessage({
          type: 'providersUpdate',
          payload: { providers: this.configManager.getProviders() }
        });
        break;
    }
  }

  /**
   * Generate the WebView HTML content.
   */
  private getWebviewContent(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<style>
${this.getCSS()}
</style>
<title>OmriCode</title>
</head>
<body>
<div id="app">
  <!-- Header -->
  <div class="omricode-header">
    <div class="omricode-header-brand">
      <div class="omricode-header-icon">⬢</div>
      <span>omricode</span>
    </div>
    <div class="omricode-header-status" id="statusText">idle</div>
    <div class="omricode-header-actions">
      <button class="omricode-header-btn" id="btnProviders" title="Manage Providers">⚙</button>
      <button class="omricode-header-btn" id="btnSnap" title="Cycle Snap Zone">⇄</button>
      <button class="omricode-header-btn" id="btnClear" title="Clear Chat">✕</button>
    </div>
  </div>

  <!-- Activity Bar -->
  <div class="omricode-activity-bar" id="activityBar">
    <span class="omricode-activity-dot" id="activityDot"></span>
    <span id="activityText">Ready</span>
  </div>

  <!-- Messages Container -->
  <div class="omricode-messages" id="messagesContainer">
    <div class="omricode-onboarding" id="onboardingWizard">
      <h2>⬢ Welcome to OmriCode</h2>
      <p>Unrestricted AI agent for your editor. Pick your provider to get started.</p>
      <div class="omricode-onboarding-steps" id="onboardingSteps">
        <div class="omricode-onboarding-step" data-step="provider">
          <span class="step-num">1</span>
          <div>
            <div class="step-label">Configure Provider</div>
            <div class="step-desc">Set up your LLM endpoint</div>
          </div>
        </div>
        <div class="omricode-onboarding-step" data-step="test">
          <span class="step-num">2</span>
          <div>
            <div class="step-label">Test Connection</div>
            <div class="step-desc">Verify the provider works</div>
          </div>
        </div>
        <div class="omricode-onboarding-step" data-step="chat">
          <span class="step-num">3</span>
          <div>
            <div class="step-label">Start Chatting</div>
            <div class="step-desc">Ask OmriCode to help you code</div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Provider Table Modal (hidden by default) -->
  <div id="providerModal" class="omricode-modal" style="display:none;">
    <div class="omricode-modal-content">
      <div class="omricode-modal-header">
        <span>⚙ Manage Providers</span>
        <button class="omricode-header-btn" id="closeModal">✕</button>
      </div>
      <div class="omricode-modal-body">
        <table class="omricode-provider-table" id="providerTable">
          <thead>
            <tr>
              <th style="width:30px">#</th>
              <th style="width:40px">⚡</th>
              <th style="width:120px;cursor:col-resize">Name</th>
              <th style="width:200px;cursor:col-resize">Endpoint</th>
              <th style="width:120px;cursor:col-resize">Model</th>
              <th style="width:40px">FC</th>
              <th style="width:30px"></th>
            </tr>
          </thead>
          <tbody id="providerTableBody"></tbody>
        </table>
        <button class="omricode-btn-primary" id="addProviderRow" style="margin-top:8px">+ Add Provider</button>
      </div>
    </div>
  </div>

  <!-- Input Bar -->
  <div class="omricode-input-bar">
    <textarea
      class="omricode-input"
      id="chatInput"
      placeholder="Ask anything... (/help for commands)"
      rows="1"
    ></textarea>
    <button class="omricode-send-btn" id="sendBtn" disabled>→</button>
  </div>
</div>

<script>
${this.getJS()}
</script>
</body>
</html>`;
  }

  /**
   * Inline CSS for the WebView.
   */
  private getCSS(): string {
    return `
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0a0a0a;--surface:#111111;--surface-2:#1a1a1a;--surface-3:#242424;--text:#d0d0d0;--text-secondary:#999999;--text-muted:#666666;--border:#222222;--border-light:#2a2a2a;--accent:#b0b0b0;--accent-hover:#cccccc;--error:#ff4444;--success:#44cc44;--glass-bg:rgba(17,17,17,0.85);--glass-border:rgba(34,34,34,0.6);--font-mono:'SF Mono','Fira Code','Cascadia Code',monospace;--font-size:13px;--spring-slow:0.4s cubic-bezier(0.34,1.56,0.64,1);--ease-out:0.2s ease-out}
body{font-family:var(--font-mono);background:var(--bg);color:var(--text);font-size:var(--font-size);overflow:hidden;height:100vh}
#app{display:flex;flex-direction:column;height:100vh}
.omricode-header{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--border);flex-shrink:0;user-select:none;background:var(--glass-bg);backdrop-filter:blur(24px) saturate(180%)}
.omricode-header-brand{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:500;text-transform:uppercase;letter-spacing:0.05em;color:var(--accent)}
.omricode-header-icon{width:18px;height:18px;border-radius:3px;background:var(--surface-2);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:9px}
.omricode-header-status{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.1em}
.omricode-header-actions{display:flex;gap:2px}
.omricode-header-btn{width:22px;height:22px;border-radius:3px;background:transparent;border:1px solid transparent;color:var(--text-muted);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:11px;transition:all var(--ease-out)}
.omricode-header-btn:hover{background:var(--surface-2);border-color:var(--border);color:var(--text)}
.omricode-activity-bar{display:flex;align-items:center;gap:6px;padding:3px 12px;border-bottom:1px solid var(--border);font-size:10px;color:var(--text-muted);flex-shrink:0;min-height:18px}
.omricode-activity-dot{width:4px;height:4px;border-radius:50%;background:var(--text-muted)}
.omricode-activity-dot.active{background:var(--accent-glow);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.omricode-messages{flex:1;overflow-y:auto;padding:8px 10px;display:flex;flex-direction:column;gap:8px;scroll-behavior:smooth}
.omricode-messages::-webkit-scrollbar{width:3px}
.omricode-messages::-webkit-scrollbar-track{background:transparent}
.omricode-messages::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px}
.omricode-onboarding{padding:20px;text-align:center}
.omricode-onboarding h2{font-size:16px;font-weight:500;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.05em}
.omricode-onboarding p{color:var(--text-secondary);margin-bottom:16px;font-size:12px;line-height:1.6}
.omricode-onboarding-steps{display:flex;flex-direction:column;gap:8px;max-width:350px;margin:0 auto}
.omricode-onboarding-step{display:flex;align-items:center;gap:10px;padding:10px;border-radius:4px;background:var(--surface);border:1px solid var(--border);cursor:pointer;transition:all var(--ease-out)}
.omricode-onboarding-step:hover{background:var(--surface-2);border-color:var(--border-light)}
.omricode-onboarding-step .step-num{width:22px;height:22px;border-radius:50%;background:var(--surface-3);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--accent);flex-shrink:0}
.omricode-onboarding-step .step-label{font-size:12px;color:var(--text)}
.omricode-onboarding-step .step-desc{font-size:10px;color:var(--text-muted)}
.omricode-bubble{display:flex;flex-direction:column;max-width:85%;animation:bubbleIn 0.3s cubic-bezier(0.34,1.56,0.64,1)}
.omricode-bubble.user{align-self:flex-end}
.omricode-bubble.assistant{align-self:flex-start}
.omricode-bubble-header{display:flex;align-items:center;gap:4px;padding:2px 6px;font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em}
.omricode-bubble.user .omricode-bubble-header{color:var(--text)}
.omricode-bubble.assistant .omricode-bubble-header{color:var(--accent)}
.omricode-bubble-body{padding:8px 12px;border-radius:4px;line-height:1.6;white-space:pre-wrap;word-break:break-word;font-size:12px}
.omricode-bubble.user .omricode-bubble-body{background:var(--surface-2);border:1px solid var(--border)}
.omricode-bubble.assistant .omricode-bubble-body{background:var(--glass-bg);border:1px solid var(--glass-border);backdrop-filter:blur(12px)}
.omricode-bubble-body code{background:var(--surface-3);padding:1px 4px;border-radius:2px;font-family:var(--font-mono);font-size:11px}
.omricode-bubble-body pre{background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:8px;overflow-x:auto;margin:6px 0;font-size:11px}
.omricode-bubble-footer{display:flex;align-items:center;gap:6px;padding:2px 6px;font-size:9px;color:var(--text-muted)}
.omricode-tool-card{margin:4px 0;border-radius:4px;border:1px solid var(--border);background:var(--surface);overflow:hidden;font-size:11px}
.omricode-tool-card-header{display:flex;align-items:center;gap:4px;padding:4px 8px;background:var(--surface-2);border-bottom:1px solid var(--border);cursor:pointer;user-select:none}
.omricode-tool-card-body{padding:6px 8px;font-size:10px;color:var(--text-secondary)}
.omricode-modal{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.7);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center}
.omricode-modal-content{background:var(--surface);border:1px solid var(--border);border-radius:6px;max-width:700px;width:90%;max-height:80vh;overflow-y:auto}
.omricode-modal-header{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid var(--border)}
.omricode-modal-body{padding:12px 14px}
.omricode-provider-table{width:100%;border-collapse:collapse;font-size:11px}
.omricode-provider-table th{padding:6px 8px;text-align:left;border-bottom:1px solid var(--border);color:var(--text-muted);font-weight:500;text-transform:uppercase;letter-spacing:0.05em;font-size:9px}
.omricode-provider-table td{padding:4px 8px;border-bottom:1px solid var(--border);vertical-align:middle}
.omricode-provider-table tr:hover td{background:var(--surface-2)}
.omricode-provider-table .active-row td{background:var(--surface-3)}
.omricode-provider-table input,.omricode-provider-table select{background:var(--bg);border:1px solid var(--border);border-radius:2px;color:var(--text);padding:3px 5px;font-family:var(--font-mono);font-size:10px;width:100%;outline:none}
.omricode-provider-table input:focus{border-color:var(--accent)}
.omricode-btn-primary{padding:6px 12px;border-radius:3px;background:var(--surface-2);color:var(--accent);border:1px solid var(--border);cursor:pointer;font-family:var(--font-mono);font-size:10px;transition:all var(--ease-out)}
.omricode-btn-primary:hover{background:var(--surface-3);border-color:var(--accent)}
.omricode-input-bar{display:flex;align-items:center;gap:6px;padding:8px 10px;border-top:1px solid var(--border);flex-shrink:0;background:var(--glass-bg);backdrop-filter:blur(24px) saturate(180%)}
.omricode-input{flex:1;padding:6px 10px;border-radius:3px;border:1px solid var(--border);background:var(--surface);font-family:var(--font-mono);font-size:12px;color:var(--text);outline:none;resize:none;min-height:28px;max-height:80px;transition:border-color var(--ease-out)}
.omricode-input:focus{border-color:var(--accent);background:var(--surface-2)}
.omricode-input::placeholder{color:var(--text-muted)}
.omricode-send-btn{width:28px;height:28px;border-radius:3px;background:var(--surface-2);border:1px solid var(--border);color:var(--accent);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:12px;transition:all var(--ease-out);flex-shrink:0}
.omricode-send-btn:hover{background:var(--surface-3);border-color:var(--accent)}
.omricode-send-btn:disabled{opacity:0.4;cursor:not-allowed}
.omricode-thinking{display:flex;align-items:center;gap:4px;padding:6px;color:var(--text-muted);font-size:11px}
.omricode-thinking-dot{width:3px;height:3px;border-radius:50%;background:var(--accent);animation:thinkingPulse 1.2s ease-in-out infinite}
.omricode-thinking-dot:nth-child(2){animation-delay:0.2s}
.omricode-thinking-dot:nth-child(3){animation-delay:0.4s}
@keyframes thinkingPulse{0%,100%{opacity:0.3;transform:scale(0.8)}50%{opacity:1;transform:scale(1.2)}}
@keyframes bubbleIn{from{opacity:0;transform:translateY(6px) scale(0.98)}to{opacity:1;transform:translateY(0) scale(1)}}
.fade-in{animation:fadeIn 0.3s ease}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
`;
  }

  /**
   * Inline JavaScript for the WebView (runs in VS Code's sandbox).
   */
  private getJS(): string {
    return `
(function() {
  const vscode = acquireVsCodeApi();
  const messagesEl = document.getElementById('messagesContainer');
  const inputEl = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');
  const statusEl = document.getElementById('statusText');
  const activityText = document.getElementById('activityText');
  const activityDot = document.getElementById('activityDot');
  const onboardingEl = document.getElementById('onboardingWizard');

  let currentMessageId = null;
  let currentAssistantEl = null;
  let isProcessing = false;

  // ─── Input auto-resize ───
  inputEl.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 80) + 'px';
    sendBtn.disabled = !this.value.trim() || isProcessing;
  });

  inputEl.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  sendBtn.addEventListener('click', sendMessage);

  function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || isProcessing) return;

    inputEl.value = '';
    inputEl.style.height = 'auto';
    sendBtn.disabled = true;

    // Hide onboarding
    if (onboardingEl) onboardingEl.style.display = 'none';

    // Add user bubble
    addBubble('user', text);
    vscode.postMessage({ type: 'userMessage', payload: { text } });
  }

  // ─── Header buttons ───
  document.getElementById('btnProviders').addEventListener('click', function() {
    document.getElementById('providerModal').style.display = 'flex';
    vscode.postMessage({ type: 'getProviders' });
  });

  document.getElementById('btnSnap').addEventListener('click', function() {
    vscode.postMessage({ type: 'toggleVisibility' });
  });

  document.getElementById('btnClear').addEventListener('click', function() {
    messagesEl.querySelectorAll('.omricode-bubble').forEach(function(el) { el.remove(); });
    vscode.postMessage({ type: 'userMessage', payload: { text: '/clear' } });
    if (onboardingEl) onboardingEl.style.display = 'block';
  });

  document.getElementById('closeModal').addEventListener('click', function() {
    document.getElementById('providerModal').style.display = 'none';
  });

  document.getElementById('addProviderRow').addEventListener('click', function() {
    vscode.postMessage({
      type: 'addProvider',
      payload: {
        provider: {
          id: crypto.randomUUID(),
          name: 'New Provider',
          endpoint: 'http://localhost:11434/v1',
          model: '',
          apiKey: '',
          isActive: false,
          supportsFC: 'auto',
          maxTokens: 4096,
          temperature: 0.7,
          order: Date.now()
        }
      }
    });
  });

  // ─── Onboarding clicks ───
  if (onboardingEl) {
    onboardingEl.addEventListener('click', function(e) {
      const step = e.target.closest('.omricode-onboarding-step');
      if (step) {
        const action = step.dataset.step;
        if (action === 'provider') {
          document.getElementById('btnProviders').click();
        }
      }
    });
  }

  // ─── Bubble rendering ───
  function addBubble(role, content, messageId) {
    const bubble = document.createElement('div');
    bubble.className = 'omricode-bubble ' + role;
    if (messageId) bubble.dataset.messageId = messageId;

    const header = document.createElement('div');
    header.className = 'omricode-bubble-header';
    header.innerHTML = '<span class="omricode-bubble-icon">' + (role === 'user' ? '◆' : '⬢') + '</span> ' + role;
    bubble.appendChild(header);

    const body = document.createElement('div');
    body.className = 'omricode-bubble-body';
    body.textContent = content;
    bubble.appendChild(body);

    const footer = document.createElement('div');
    footer.className = 'omricode-bubble-footer';
    footer.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    bubble.appendChild(footer);

    messagesEl.appendChild(bubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    if (role === 'assistant') {
      currentAssistantEl = bubble;
      currentMessageId = messageId;
    }

    return bubble;
  }

  function updateBubble(messageId, content) {
    const bubble = messagesEl.querySelector('[data-message-id="' + messageId + '"]');
    if (!bubble) return;
    const body = bubble.querySelector('.omricode-bubble-body');
    if (body) body.textContent = content;
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function setStatus(statusText) {
    statusEl.textContent = statusText;
    activityText.textContent = statusText.charAt(0).toUpperCase() + statusText.slice(1);
    activityDot.className = 'omricode-activity-dot' + (statusText !== 'idle' ? ' active' : '');
  }

  // ─── Thinking indicator ───
  function showThinking(messageId) {
    const bubble = messagesEl.querySelector('[data-message-id="' + messageId + '"]');
    if (!bubble) return;
    const body = bubble.querySelector('.omricode-bubble-body');
    if (!body) return;
    body.innerHTML = '<div class="omricode-thinking"><span class="omricode-thinking-dot"></span><span class="omricode-thinking-dot"></span><span class="omricode-thinking-dot"></span></div>';
  }

  // ─── Tool call card ───
  function addToolCard(messageId, toolName, args, status) {
    const bubble = messagesEl.querySelector('[data-message-id="' + messageId + '"]');
    if (!bubble) return;
    const body = bubble.querySelector('.omricode-bubble-body');

    const card = document.createElement('div');
    card.className = 'omricode-tool-card ' + status;
    card.innerHTML = '<div class="omricode-tool-card-header">◇ ' + toolName + ' <span style="margin-left:auto;font-size:9px">' + status + '</span></div>';
    if (args) {
      card.innerHTML += '<div class="omricode-tool-card-body"><pre style="margin:0;font-size:9px">' + escapeHtml(JSON.stringify(args, null, 2).slice(0, 200)) + '</pre></div>';
    }
    body.appendChild(card);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ─── Provider table rendering ───
  function renderProviderTable(providers) {
    const tbody = document.getElementById('providerTableBody');
    tbody.innerHTML = '';
    providers.forEach(function(p, i) {
      const tr = document.createElement('tr');
      if (p.isActive) tr.className = 'active-row';

      tr.innerHTML = [
        '<td>' + (i + 1) + '</td>',
        '<td><input type="radio" name="activeProvider" value="' + p.id + '" ' + (p.isActive ? 'checked' : '') + '></td>',
        '<td><input type="text" value="' + escapeHtml(p.name) + '" class="provider-name" data-id="' + p.id + '"></td>',
        '<td><input type="text" value="' + escapeHtml(p.endpoint) + '" class="provider-endpoint" data-id="' + p.id + '"></td>',
        '<td><input type="text" value="' + escapeHtml(p.model) + '" class="provider-model" data-id="' + p.id + '"></td>',
        '<td style="font-size:9px;color:' + (p.supportsFC ? 'var(--success)' : 'var(--text-muted)') + '">' + (p.supportsFC ? '✓' : (p.supportsFC === 'auto' ? '?' : '✕')) + '</td>',
        '<td><button class="omricode-header-btn provider-remove" data-id="' + p.id + '" style="color:var(--error)">✕</button></td>'
      ].join('');

      tbody.appendChild(tr);
    });

    // Attach events
    tbody.querySelectorAll('input[type="radio"]').forEach(function(radio) {
      radio.addEventListener('change', function() {
        vscode.postMessage({ type: 'setActiveProvider', payload: { providerId: this.value } });
      });
    });

    tbody.querySelectorAll('.provider-name').forEach(function(input) {
      input.addEventListener('change', function() {
        vscode.postMessage({ type: 'updateProvider', payload: { providerId: this.dataset.id, updates: { name: this.value } } });
      });
    });

    tbody.querySelectorAll('.provider-endpoint').forEach(function(input) {
      input.addEventListener('change', function() {
        vscode.postMessage({ type: 'updateProvider', payload: { providerId: this.dataset.id, updates: { endpoint: this.value } } });
      });
    });

    tbody.querySelectorAll('.provider-model').forEach(function(input) {
      input.addEventListener('change', function() {
        vscode.postMessage({ type: 'updateProvider', payload: { providerId: this.dataset.id, updates: { model: this.value } } });
      });
    });

    tbody.querySelectorAll('.provider-remove').forEach(function(btn) {
      btn.addEventListener('click', function() {
        vscode.postMessage({ type: 'removeProvider', payload: { providerId: this.dataset.id } });
      });
    });
  }

  // ─── Handle messages from extension host ───
  window.addEventListener('message', function(event) {
    const message = event.data;
    const payload = message.payload || {};

    switch (message.type) {
      case 'messageStart':
        const msgId = payload.messageId;
        addBubble('assistant', '', msgId);
        showThinking(msgId);
        isProcessing = true;
        sendBtn.disabled = true;
        setStatus('thinking');
        break;

      case 'messageChunk':
        updateBubble(payload.messageId, payload.chunk);
        break;

      case 'toolCallStart':
        setStatus('executing');
        addToolCard(payload.messageId, payload.toolCall.name, payload.toolCall.arguments, 'running');
        break;

      case 'toolCallComplete':
        setStatus('thinking');
        addToolCard(payload.messageId, payload.toolCall.name + ' ✓', null, 'success');
        break;

      case 'messageComplete':
        setStatus('idle');
        isProcessing = false;
        sendBtn.disabled = false;
        break;

      case 'messageError':
        setStatus('error');
        isProcessing = false;
        sendBtn.disabled = false;
        break;

      case 'stateChange':
        setStatus(payload.state);
        break;

      case 'providersUpdate':
        renderProviderTable(payload.providers || []);
        break;

      case 'snapChanged':
        const props = payload.cssProps || {};
        Object.entries(props).forEach(function(entry) {
          document.documentElement.style.setProperty(entry[0], entry[1]);
        });
        break;
    }
  });

  // ─── Tell host we're ready ───
  vscode.postMessage({ type: 'webviewReady' });

  // Focus input on load
  inputEl.focus();
})();
`;
  }

  /**
   * Dispose of the panel and its resources.
   */
  dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
    if (this.panel) {
      this.panel.dispose();
      this.panel = null;
    }
  }
}
