export interface EditorClient {
  clientId: string;
  name: string;
  type: 'vscode' | 'godot' | 'blender';
  version?: string;
  capabilities: string[];
  lastSeen: number;
}

export class ClientManager {
  private clients = new Map<string, EditorClient>();

  register(clientId: string | undefined, name: string, type: string, capabilities: string[], version?: string): string {
    const id = clientId || `editor_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.clients.set(id, {
      clientId: id, name, type: type as EditorClient['type'],
      version, capabilities, lastSeen: Date.now()
    });
    return id;
  }

  heartbeat(clientId: string): boolean {
    const c = this.clients.get(clientId);
    if (!c) return false;
    c.lastSeen = Date.now();
    return true;
  }

  unregister(clientId: string): boolean {
    return this.clients.delete(clientId);
  }

  getClient(clientId: string): EditorClient | undefined {
    return this.clients.get(clientId);
  }

  getAllClients(): EditorClient[] {
    return Array.from(this.clients.values());
  }

  findClientByCapability(capability: string): EditorClient | undefined {
    return this.getAllClients().find(c => c.capabilities.includes(capability));
  }

  findBestClient(requiredCapabilities: string[]): EditorClient | undefined {
    return this.getAllClients()
      .filter(c => requiredCapabilities.every(cap => c.capabilities.includes(cap)))
      .sort((a, b) => b.capabilities.length - a.capabilities.length)[0];
  }
}
