/**
 * app.js
 * OmriCode — WebView Application Script
 *
 * Runs inside the VS Code WebView sandbox.
 * Handles UI rendering, user input, and communication
 * with the extension host via postMessage/onDidReceiveMessage.
 *
 * The main rendering logic is inline in ChatPanel.ts's getJS().
 * This file serves as the entry point for the standalone webview build.
 */

(function () {
  const vscode = acquireVsCodeApi();

  const messagesEl = document.getElementById('messagesContainer');
  const inputEl = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');
  const statusEl = document.getElementById('statusText');

  let isProcessing = false;

  // ── Input auto-resize ──
  inputEl.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 80) + 'px';
    sendBtn.disabled = !this.value.trim() || isProcessing;
  });

  inputEl.addEventListener('keydown', function (e) {
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
    addBubble('user', text);
    vscode.postMessage({ type: 'userMessage', payload: { text } });
  }

  function addBubble(role, content, messageId) {
    const bubble = document.createElement('div');
    bubble.className = 'omricode-bubble ' + role;
    if (messageId) bubble.dataset.messageId = messageId;
    const body = document.createElement('div');
    body.className = 'omricode-bubble-body';
    body.textContent = content;
    bubble.appendChild(body);
    messagesEl.appendChild(bubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return bubble;
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  // ── Handle messages from extension host ──
  window.addEventListener('message', function (event) {
    const msg = event.data;
    const payload = msg.payload || {};
    switch (msg.type) {
      case 'messageStart':
        isProcessing = true;
        sendBtn.disabled = true;
        setStatus('thinking');
        break;
      case 'messageChunk':
        setStatus('responding');
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
    }
  });

  vscode.postMessage({ type: 'webviewReady' });
  inputEl.focus();
})();
