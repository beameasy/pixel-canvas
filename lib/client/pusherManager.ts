import { pusherClient } from './pusher';

class PusherManager {
  private static instance: PusherManager;
  private channel: any;
  private subscribed: boolean = false;
  private eventHandlers: Map<string, Set<(data: any) => void>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private isReconnecting = false;

  private constructor() {
    this.initializeChannel();
    
    // Set up periodic health check
    setInterval(() => this.checkConnectionHealth(), 30000);
  }

  private initializeChannel() {
    if (this.channel) {
      this.channel.unbind_all();
      pusherClient.unsubscribe('canvas');
    }
    
    // Force disconnect and reconnect of the pusher client
    pusherClient.disconnect();
    pusherClient.connect();
    
    this.channel = pusherClient.subscribe('canvas');
    
    this.channel.bind('pusher:subscription_succeeded', () => {
      console.log('✅ PusherManager: Channel subscription succeeded');
      this.subscribed = true;
      this.rebindHandlers();
    });
    
    // Add subscription error handling
    this.channel.bind('pusher:subscription_error', (error: any) => {
      console.error('❌ PusherManager: Channel subscription failed', error);
      this.subscribed = false;
      
      // Attempt to recover
      setTimeout(() => this.reconnect(), 2000);
    });
  }

  private rebindHandlers() {
    if (!this.channel?.subscribed) return;
    
    console.log(`🔁 PusherManager: Rebinding handlers for ${this.eventHandlers.size} events`);
    
    this.eventHandlers.forEach((handlers, eventName) => {
      console.log(`🔁 PusherManager: Rebinding ${handlers.size} handlers for event '${eventName}'`);
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
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Maximum reconnection attempts reached');
      return;
    }
    
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    
    console.log(`🔴 PusherManager: Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    this.subscribed = false;
    
    // Completely disconnect and unsubscribe first
    if (this.channel) {
      this.channel.unbind_all();
      pusherClient.unsubscribe('canvas');
    }
    
    // Force disconnect pusher client
    pusherClient.disconnect();
    
    setTimeout(() => {
      pusherClient.connect();
      this.channel = pusherClient.subscribe('canvas');
      
      this.channel.bind('pusher:subscription_succeeded', () => {
        this.reconnectAttempts = 0;
        console.log('✅ PusherManager: Channel subscription succeeded after reconnect');
        this.subscribed = true;
        this.rebindHandlers();
      });
      
      // Add connection state logging
      pusherClient.connection.bind('state_change', (states: { current: string, previous: string }) => {
        console.log(`📡 Pusher reconnect state changed from ${states.previous} to ${states.current}`);
      });
    }, delay);
  }

  isConnected() {
    return this.channel?.subscribed && pusherClient.connection.state === 'connected';
  }

  private checkConnectionHealth() {
    if (!this.isConnected() && !this.isReconnecting) {
      console.log('🔄 PusherManager: Connection health check failed, reconnecting');
      this.reconnect();
    }
  }

  static getInstance(): PusherManager {
    if (!PusherManager.instance) {
      PusherManager.instance = new PusherManager();
    }
    return PusherManager.instance;
  }
}

export const pusherManager = PusherManager.getInstance(); 