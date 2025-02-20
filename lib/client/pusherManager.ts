import { pusherClient } from './pusher';

class PusherManager {
  private static instance: PusherManager;
  private channel: any;
  private subscribed: boolean = false;
  private eventHandlers: Map<string, Set<(data: any) => void>> = new Map();
  private connectionAttempts: number = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 3;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private lastReconnectTime: number = 0;
  private readonly MIN_RECONNECT_INTERVAL = 5000; // Minimum 5 seconds between reconnects

  private constructor() {
    this.initializeChannel();
    this.setupConnectionHandlers();
  }

  private setupConnectionHandlers() {
    pusherClient.connection.bind('state_change', (states: { current: string, previous: string }) => {
      console.log(`🔄 Pusher state change: ${states.previous} -> ${states.current}`);
      
      if (states.current === 'disconnected') {
        this.subscribed = false;
        this.handleDisconnection();
      } else if (states.current === 'connected') {
        this.connectionAttempts = 0;
        this.initializeChannel();
      }
    });
  }

  private handleDisconnection() {
    const now = Date.now();
    if (now - this.lastReconnectTime < this.MIN_RECONNECT_INTERVAL) {
      console.log('⏳ Skipping reconnect - too soon since last attempt');
      return;
    }

    if (this.connectionAttempts < this.MAX_RECONNECT_ATTEMPTS) {
      this.connectionAttempts++;
      console.log(`🔄 Scheduling reconnection attempt ${this.connectionAttempts}/${this.MAX_RECONNECT_ATTEMPTS}`);
      
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
      }
      
      this.reconnectTimeout = setTimeout(() => {
        this.reconnect();
        this.lastReconnectTime = Date.now();
      }, 1000 * Math.min(this.connectionAttempts, 3));
    }
  }

  private initializeChannel() {
    if (this.channel?.subscribed) {
      console.log('✅ Channel already subscribed');
      return;
    }

    if (this.channel) {
      this.channel.unbind_all();
      pusherClient.unsubscribe('canvas');
    }
    
    this.channel = pusherClient.subscribe('canvas');
    
    this.channel.bind('pusher:subscription_succeeded', () => {
      console.log('✅ Channel subscription succeeded');
      this.subscribed = true;
      this.rebindHandlers();
    });

    this.channel.bind('pusher:subscription_error', (error: any) => {
      console.error('❌ Channel subscription error:', error);
      this.subscribed = false;
    });
  }

  private rebindHandlers() {
    if (!this.channel?.subscribed) return;
    
    this.eventHandlers.forEach((handlers, eventName) => {
      handlers.forEach(handler => {
        this.channel.bind(eventName, handler);
      });
    });
  }

  subscribe(eventName: string, callback: (data: any) => void) {
    if (!this.eventHandlers.has(eventName)) {
      this.eventHandlers.set(eventName, new Set());
    }
    this.eventHandlers.get(eventName)?.add(callback);

    if (this.channel?.subscribed) {
      this.channel.bind(eventName, callback);
    }
  }

  unsubscribe(eventName: string, callback: (data: any) => void) {
    this.eventHandlers.get(eventName)?.delete(callback);
    if (this.eventHandlers.get(eventName)?.size === 0) {
      this.eventHandlers.delete(eventName);
    }

    if (this.channel) {
      this.channel.unbind(eventName, callback);
    }
  }

  reconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (!this.subscribed && pusherClient.connection.state !== 'connected') {
      console.log('🔄 Forcing reconnection');
      pusherClient.connect();
    }
  }

  isConnected() {
    return this.channel?.subscribed && pusherClient.connection.state === 'connected';
  }

  static getInstance(): PusherManager {
    if (!PusherManager.instance) {
      PusherManager.instance = new PusherManager();
    }
    return PusherManager.instance;
  }
}

export const pusherManager = PusherManager.getInstance(); 