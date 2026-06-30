import * as vscode from 'vscode';
import { OmriClient, AgentEvent } from '../OmriClient';
import { gatherEditorContext } from '../context/EditorContext';
export class ChatPanel implements vscode.Disposable {
  private context: vscode.ExtensionContext;
  private omriClient: OmriClient;
  private panel: vscode.WebviewPanel | null = null;
  private disposables: vscode.Disposable[] = [];
  private isAppConnected = false;

  constructor(context: vscode.ExtensionContext, omriClient: OmriClient) {
    this.context = context;
    this.omriClient = omriClient;
  }

  initialize(): void {}

  showAppNotRunning(): void {
    this.isAppConnected = false;
    if (this.panel) this.postMessage({ type: 'appStatus', payload: { connected: false } });
  }

  reveal(): void {
    if (this.panel) { this.panel.reveal(this.panel.viewColumn); return; }

    this.panel = vscode.window.createWebviewPanel(
      'omricode.chat', 'OmriCode',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'webview')] }
    );

    this.panel.webview.html = this.getWebviewContent();
    this.panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'icon.png');

    this.disposables.push(this.panel.webview.onDidReceiveMessage(this.handleMessage.bind(this)));
    this.disposables.push(this.panel.onDidDispose(() => { this.panel = null; }));

    // Send initial app status
    this.isAppConnected = this.omriClient.isConnected;
    this.postMessage({ type: 'appStatus', payload: { connected: this.isAppConnected } });
  }

  toggle(): void {
    if (this.panel) { this.panel.dispose(); this.panel = null; }
    else this.reveal();
  }

  sendMessage(text: string): void {
    this.reveal();
    this.postMessage({ type: 'userMessage', payload: { text } });
    this.handleUserMessage(text);
  }

  postMessage(message: Record<string, unknown>): void {
    this.panel?.webview.postMessage(message);
  }

  private async handleMessage(message: Record<string, unknown>): Promise<void> {
    const type = message.type as string;
    const payload = message.payload as Record<string, unknown> || {};

    switch (type) {
      case 'userMessage':
        const text = payload.text as string;
        if (text?.trim()) this.handleUserMessage(text.trim());
        break;

      case 'cancelRequest':
        this.omriClient.cancel();
        break;

      case 'webviewReady':
        this.postMessage({ type: 'appStatus', payload: { connected: this.isAppConnected } });
        break;
    }
  }

  private async handleUserMessage(text: string): Promise<void> {
    if (!this.omriClient.isConnected) {
      this.postMessage({ type: 'messageError', payload: { error: 'OmriCode app is not running. Launch it first.' } });
      return;
    }

    const messageId = `msg_${Date.now()}`;
    this.postMessage({ type: 'messageStart', payload: { messageId } });
    this.postMessage({ type: 'stateChange', payload: { state: 'thinking' } });

    const context = gatherEditorContext();

    await this.omriClient.sendMessage(text, context, (event: AgentEvent) => {
      switch (event.type) {
        case 'text':
          this.postMessage({ type: 'messageChunk', payload: { messageId, chunk: event.content } });
          break;
        case 'tool_call':
          this.postMessage({ type: 'toolCallStart', payload: { messageId, toolCall: { id: event.id, name: event.name, arguments: event.arguments } } });
          this.postMessage({ type: 'stateChange', payload: { state: 'executing' } });
          break;
        case 'tool_result':
          this.postMessage({ type: 'toolCallComplete', payload: { messageId, toolCall: { id: (event as any).id }, result: event } });
          this.postMessage({ type: 'stateChange', payload: { state: 'thinking' } });
          break;
        case 'state':
          this.postMessage({ type: 'stateChange', payload: { state: event.state } });
          break;
        case 'done':
          this.postMessage({ type: 'messageComplete', payload: { messageId } });
          this.postMessage({ type: 'stateChange', payload: { state: 'idle' } });
          break;
        case 'error':
          this.postMessage({ type: 'messageError', payload: { messageId, error: event.error } });
          this.postMessage({ type: 'stateChange', payload: { state: 'idle' } });
          break;
      }
    }).catch((err) => {
      this.postMessage({ type: 'messageError', payload: { messageId, error: (err as Error).message } });
      this.postMessage({ type: 'stateChange', payload: { state: 'idle' } });
    });
  }

  private getWebviewContent(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0a0a0a;--surface:#111111;--surface-2:#1a1a1a;--surface-3:#242424;--text:#d0d0d0;--text-secondary:#999;--text-muted:#666;--border:#222;--border-light:#2a2a2a;--accent:#b0b0b0;--accent-hover:#ccc;--error:#ff4444;--success:#44cc44;--glass-bg:rgba(17,17,17,0.85);--glass-border:rgba(34,34,34,0.6);--font-mono:'SF Mono','Fira Code','Cascadia Code',monospace;--font-size:13px}
body{font-family:var(--font-mono);background:var(--bg);color:var(--text);font-size:var(--font-size);overflow:hidden;height:100vh}
#app{display:flex;flex-direction:column;height:100vh}
.header{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--border);flex-shrink:0;background:var(--glass-bg);backdrop-filter:blur(24px) saturate(180%)}
.header-brand{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:500;text-transform:uppercase;letter-spacing:.05em;color:var(--accent)}
.header-status{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.1em}
.activity-bar{display:flex;align-items:center;gap:6px;padding:3px 12px;border-bottom:1px solid var(--border);font-size:10px;color:var(--text-muted);flex-shrink:0}
.activity-dot{width:4px;height:4px;border-radius:50%;background:var(--text-muted)}
.activity-dot.active{background:var(--accent);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.banner{display:none;padding:6px 12px;font-size:10px;background:rgba(255,68,68,0.1);border-bottom:1px solid var(--error);color:var(--error);flex-shrink:0}
.messages{flex:1;overflow-y:auto;padding:8px 10px;display:flex;flex-direction:column;gap:8px;scroll-behavior:smooth}
.messages::-webkit-scrollbar{width:3px}
.messages::-webkit-scrollbar-track{background:transparent}
.messages::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px}
.bubble{display:flex;flex-direction:column;max-width:85%;animation:bubbleIn 0.3s cubic-bezier(0.34,1.56,0.64,1)}
.bubble.user{align-self:flex-end}
.bubble.assistant{align-self:flex-start}
.bubble-header{display:flex;align-items:center;gap:4px;padding:2px 6px;font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em}
.bubble.user .bubble-header{color:var(--text)}
.bubble.assistant .bubble-header{color:var(--accent)}
.bubble-body{padding:8px 12px;border-radius:4px;line-height:1.6;white-space:pre-wrap;word-break:break-word;font-size:12px}
.bubble.user .bubble-body{background:var(--surface-2);border:1px solid var(--border)}
.bubble.assistant .bubble-body{background:var(--glass-bg);border:1px solid var(--glass-border);backdrop-filter:blur(12px)}
.tool-card{margin:4px 0;border-radius:4px;border:1px solid var(--border);background:var(--surface);overflow:hidden;font-size:11px}
.tool-card-header{display:flex;align-items:center;gap:4px;padding:4px 8px;background:var(--surface-2);border-bottom:1px solid var(--border)}
.tool-card-body{padding:6px 8px;font-size:10px;color:var(--text-secondary)}
.thinking{display:flex;align-items:center;gap:4px;padding:6px;color:var(--text-muted);font-size:11px}
.thinking-dot{width:3px;height:3px;border-radius:50%;background:var(--accent);animation:thinkingPulse 1.2s ease-in-out infinite}
.thinking-dot:nth-child(2){animation-delay:.2s}
.thinking-dot:nth-child(3){animation-delay:.4s}
@keyframes thinkingPulse{0%,100%{opacity:.3;transform:scale(.8)}50%{opacity:1;transform:scale(1.2)}}
@keyframes bubbleIn{from{opacity:0;transform:translateY(6px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}
.input-bar{display:flex;align-items:center;gap:6px;padding:8px 10px;border-top:1px solid var(--border);flex-shrink:0;background:var(--glass-bg);backdrop-filter:blur(24px) saturate(180%)}
.input{flex:1;padding:6px 10px;border-radius:3px;border:1px solid var(--border);background:var(--surface);font-family:var(--font-mono);font-size:12px;color:var(--text);outline:none;resize:none;min-height:28px;max-height:80px}
.input:focus{border-color:var(--accent);background:var(--surface-2)}
.input::placeholder{color:var(--text-muted)}
.send-btn{width:28px;height:28px;border-radius:3px;background:var(--surface-2);border:1px solid var(--border);color:var(--accent);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0}
.send-btn:hover{background:var(--surface-3);border-color:var(--accent)}
.send-btn:disabled{opacity:.4;cursor:not-allowed}
</style>
<title>OmriCode</title>
</head>
<body>
<div id="app">
  <div class="header">
    <div class="header-brand"><span style="width:18px;height:18px;border-radius:3px;background:var(--surface-2);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:9px">⬢</span> omricode</div>
    <div class="header-status" id="statusText">disconnected</div>
    <div><button class="send-btn" id="btnClear" style="font-size:9px;width:20px;height:20px" title="Clear">✕</button></div>
  </div>
  <div class="activity-bar"><span class="activity-dot" id="activityDot"></span><span id="activityText">Ready</span></div>
  <div class="banner" id="offlineBanner">OmriCode app not running. Launch it to use AI features.</div>
  <div class="messages" id="messagesContainer"></div>
  <div class="input-bar">
    <textarea class="input" id="chatInput" placeholder="Ask anything..." rows="1"></textarea>
    <button class="send-btn" id="sendBtn" disabled>→</button>
  </div>
</div>
<script>
(function() {
  const vscode = acquireVsCodeApi();
  const messagesEl = document.getElementById('messagesContainer');
  const inputEl = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');
  const statusEl = document.getElementById('statusText');
  const activityText = document.getElementById('activityText');
  const activityDot = document.getElementById('activityDot');
  const offlineBanner = document.getElementById('offlineBanner');
  let isProcessing = false;

  inputEl.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 80) + 'px';
    sendBtn.disabled = !this.value.trim() || isProcessing;
  });
  inputEl.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  sendBtn.addEventListener('click', send);

  document.getElementById('btnClear').addEventListener('click', function() {
    messagesEl.querySelectorAll('.bubble').forEach(function(el) { el.remove(); });
  });

  function send() {
    const text = inputEl.value.trim();
    if (!text || isProcessing) return;
    inputEl.value = ''; inputEl.style.height = 'auto'; sendBtn.disabled = true;
    addBubble('user', text);
    vscode.postMessage({ type: 'userMessage', payload: { text } });
  }

  function addBubble(role, content, messageId) {
    const bubble = document.createElement('div');
    bubble.className = 'bubble ' + role;
    if (messageId) bubble.dataset.messageId = messageId;
    const h = document.createElement('div');
    h.className = 'bubble-header';
    h.innerHTML = '<span>' + (role === 'user' ? '◆' : '⬢') + '</span> ' + role;
    bubble.appendChild(h);
    const b = document.createElement('div');
    b.className = 'bubble-body';
    if (role === 'assistant' && !content) {
      b.innerHTML = '<div class="thinking"><span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span></div>';
    } else {
      b.textContent = content;
    }
    bubble.appendChild(b);
    messagesEl.appendChild(bubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return bubble;
  }

  function setStatus(s) {
    statusEl.textContent = s;
    activityText.textContent = s.charAt(0).toUpperCase() + s.slice(1);
    activityDot.className = 'activity-dot' + (s !== 'idle' && s !== 'disconnected' ? ' active' : '');
  }

  window.addEventListener('message', function(event) {
    const msg = event.data;
    const p = msg.payload || {};
    switch (msg.type) {
      case 'appStatus':
        if (p.connected) {
          offlineBanner.style.display = 'none';
          setStatus('idle');
          isProcessing = false;
          sendBtn.disabled = false;
        } else {
          offlineBanner.style.display = 'block';
          setStatus('disconnected');
        }
        break;
      case 'messageStart':
        addBubble('assistant', '', p.messageId);
        isProcessing = true;
        sendBtn.disabled = true;
        setStatus('thinking');
        break;
      case 'messageChunk': {
        const bubble = messagesEl.querySelector('[data-message-id="' + p.messageId + '"]');
        if (bubble) {
          const body = bubble.querySelector('.bubble-body');
          if (!body.textContent) body.innerHTML = '';
          body.textContent += p.chunk;
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }
        break;
      }
      case 'toolCallStart': {
        const bubble = messagesEl.querySelector('[data-message-id="' + p.messageId + '"]');
        if (bubble) {
          const body = bubble.querySelector('.bubble-body');
          const card = document.createElement('div');
          card.className = 'tool-card';
          card.innerHTML = '<div class="tool-card-header">◇ ' + (p.toolCall?.name || 'tool') + ' <span style="margin-left:auto;font-size:9px">running</span></div>';
          if (p.toolCall?.arguments) {
            card.innerHTML += '<div class="tool-card-body"><pre style="margin:0;font-size:9px">' + escapeHtml(JSON.stringify(p.toolCall.arguments, null, 2).slice(0, 200)) + '</pre></div>';
          }
          body.appendChild(card);
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }
        break;
      }
      case 'toolCallComplete':
        setStatus('thinking');
        break;
      case 'messageComplete':
        setStatus('idle'); isProcessing = false; sendBtn.disabled = false;
        break;
      case 'messageError':
        setStatus('idle'); isProcessing = false; sendBtn.disabled = false;
        if (p.error) addBubble('assistant', 'Error: ' + p.error);
        break;
      case 'stateChange':
        setStatus(p.state);
        break;
    }
  });

  function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  vscode.postMessage({ type: 'webviewReady' });
  inputEl.focus();
})();
</script>
</body>
</html>`;
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
    this.panel?.dispose();
    this.panel = null;
  }
}
