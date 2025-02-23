import { pusherClient } from './pusher';

class PusherManager {
  private static instance: PusherManager;
  private channel: any;
  private subscribed: boolean = false;
  private eventHandlers: Map<string, Set<(data: any) => void>> = new Map();

  private constructor() {
    this.initializeChannel();
  }

  private initializeChannel() {
    if (this.channel) {
      this.channel.unbind_all();
      pusherClient.unsubscribe('canvas');
    }
    
    this.channel = pusherClient.subscribe('canvas');
    
    this.channel.bind('pusher:subscription_succeeded', () => {
      console.log('✅ PusherManager: Channel subscription succeeded');
      this.subscribed = true;
      this.rebindHandlers();
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
    this.initializeChannel();
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