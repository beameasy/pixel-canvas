import { pusherClient } from './pusher';

// Add a DEBUG flag to control logging
const DEBUG = false; // Set to false to disable all logs

class PusherManager {
  private static instance: PusherManager;
  private channel: any;
  private subscribed: boolean = false;
  private eventHandlers: Map<string, Set<(data: any) => void>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private isReconnecting = false;
  private lastEventTime = 0;
  private healthCheckInterval: any = null;
  private disconnectTimeout: any = null;
  private lastReconnectTime = 0;  // Track when we last attempted reconnection
  private eventBuffer: Map<string, any> = new Map();  // Store latest events
  private connectionCount = 0;  // Track how many components need a connection

  private constructor() {
    this.initializeChannel();
    
    // More aggressive health check - every 15 seconds instead of 30
    this.healthCheckInterval = setInterval(() => this.checkConnectionHealth(), 15000);
    
    // Also listen for visibility changes to force reconnection when tab becomes visible
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  // Helper function for logging that only logs when DEBUG is true
  private log(message: string, data?: any) {
    if (DEBUG) {
      if (data) {
        console.log(message, data);
      } else {
        console.log(message);
      }
    }
  }

  private handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      this.log('🔄 PusherManager: Page became visible, checking connection');
      // When page becomes visible, force a connection check immediately
      this.checkConnectionHealth(true);
    }
  };

  private initializeChannel() {
    this.log('🔄 PusherManager: Initializing channel');
    
    if (this.channel) {
      this.log('🔄 PusherManager: Unbinding existing channel');
      this.channel.unbind_all();
      pusherClient.unsubscribe('canvas');
    }
    
    // Force disconnect and reconnect of the pusher client
    this.log('🔄 PusherManager: Disconnecting Pusher client');
    pusherClient.disconnect();
    
    this.log('🔄 PusherManager: Connecting Pusher client');
    pusherClient.connect();
    
    this.log('🔄 PusherManager: Subscribing to channel');
    this.channel = pusherClient.subscribe('canvas');
    
    // Monitor connection state changes
    pusherClient.connection.bind('state_change', (states: { current: string, previous: string }) => {
      this.log(`📡 PusherManager: Connection state changed from ${states.previous} to ${states.current}`);
      
      if (states.current === 'connected') {
        this.reconnectAttempts = 0;
        this.isReconnecting = false;
        this.onConnectionEstablished();
      } else if (states.current === 'disconnected' || states.current === 'failed') {
        // If we disconnect or fail, try to reconnect after a short delay
        if (!this.isReconnecting) {
          this.log('🔄 PusherManager: Connection lost, scheduling reconnect');
          this.isReconnecting = true;
          
          // Cancel any existing reconnect timeout
          if (this.disconnectTimeout) {
            clearTimeout(this.disconnectTimeout);
          }
          
          // Schedule a reconnect
          this.disconnectTimeout = setTimeout(() => {
            this.log('🔄 PusherManager: Executing scheduled reconnect');
            this.reconnect();
          }, 2000);
        }
      }
    });
    
    this.channel.bind('pusher:subscription_succeeded', () => {
      this.log('✅ PusherManager: Channel subscription succeeded');
      this.subscribed = true;
      this.rebindHandlers();
    });
    
    // Add subscription error handling
    this.channel.bind('pusher:subscription_error', (error: any) => {
      // Keep error logs since they might be important
      console.error('❌ PusherManager: Channel subscription failed', error);
      this.subscribed = false;
      
      // Attempt to recover
      setTimeout(() => this.reconnect(), 2000);
    });
  }

  private onConnectionEstablished() {
    this.log('✅ PusherManager: Connection established, setting up ping');
    
    // Reset reconnection counters
    this.reconnectAttempts = 0;
    this.isReconnecting = false;
    
    // Set up a ping to keep the connection alive
    if (this.channel?.subscribed) {
      this.rebindHandlers();
    }
  }

  private rebindHandlers() {
    if (!this.channel?.subscribed) return;
    
    this.log(`🔁 PusherManager: Rebinding handlers for ${this.eventHandlers.size} events`);
    
    this.eventHandlers.forEach((handlers, eventName) => {
      this.log(`🔁 PusherManager: Rebinding ${handlers.size} handlers for event '${eventName}'`);
      this.channel.bind(eventName, (data: any) => {
        // Update last event time whenever we receive any event
        this.lastEventTime = Date.now();
        
        // Store this event for future subscribers
        this.eventBuffer.set(eventName, data);
        
        // Notify all handlers
        handlers.forEach(handler => handler(data));
      });
    });
  }

  subscribe(eventName: string, callback: (data: any) => void) {
    this.log(`➕ PusherManager: Subscribing to event '${eventName}'`);
    
    if (!this.eventHandlers.has(eventName)) {
      this.eventHandlers.set(eventName, new Set());
    }
    this.eventHandlers.get(eventName)?.add(callback);

    if (this.channel?.subscribed) {
      this.channel.bind(eventName, (data: any) => {
        // Update last event time whenever we receive any event
        this.lastEventTime = Date.now();
        callback(data);
      });
      
      // Immediately send cached event if available
      const cachedEvent = this.eventBuffer.get(eventName);
      if (cachedEvent) {
        setTimeout(() => callback(cachedEvent), 0);
      }
    } else {
      this.log(`⚠️ PusherManager: Channel not subscribed yet, event '${eventName}' will be bound later`);
      // If we're not subscribed yet, make sure we're connected
      this.checkConnectionHealth(true);
    }
  }

  unsubscribe(eventName: string, callback: (data: any) => void) {
    this.log(`➖ PusherManager: Unsubscribing from event '${eventName}'`);
    
    const handlers = this.eventHandlers.get(eventName);
    if (handlers) {
      handlers.delete(callback);
      if (handlers.size === 0) {
        this.eventHandlers.delete(eventName);
      }
    }

    if (this.channel) {
      this.channel.unbind(eventName, callback);
    }
  }

  reconnect() {
    // Throttle reconnect attempts - don't try more than once every 5 seconds
    const now = Date.now();
    if (now - this.lastReconnectTime < 5000) {
      this.log('🛑 PusherManager: Throttling reconnect attempt, too soon');
      return;
    }
    
    this.lastReconnectTime = now;
    
    if (this.isReconnecting) {
      this.log('🔄 PusherManager: Already reconnecting, skipping duplicate attempt');
      return;
    }
    
    this.isReconnecting = true;
    
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('⛔ PusherManager: Maximum reconnection attempts reached');
      return;
    }
    
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 10000);
    this.reconnectAttempts++;
    
    this.log(`🔄 PusherManager: Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    this.subscribed = false;
    
    // Completely disconnect and unsubscribe first
    if (this.channel) {
      this.channel.unbind_all();
      pusherClient.unsubscribe('canvas');
    }
    
    // Force disconnect pusher client
    pusherClient.disconnect();
    
    setTimeout(() => {
      this.log('🔄 PusherManager: Executing reconnect after delay');
      this.initializeChannel();
    }, delay);
  }

  isConnected() {
    return this.channel?.subscribed && pusherClient.connection.state === 'connected';
  }

  private checkConnectionHealth(forceReconnect = false) {
    // Connection status
    const connectionStatus = {
      isSubscribed: !!this.channel?.subscribed,
      connectionState: pusherClient.connection.state,
      timeSinceLastEvent: Date.now() - this.lastEventTime,
      reconnectAttempts: this.reconnectAttempts,
      connectionCount: this.connectionCount
    };
    
    this.log('🔍 PusherManager: Connection health check', connectionStatus);
    
    // Only check if we have components that need connectivity
    if (this.connectionCount === 0) {
      this.log('🔌 PusherManager: No active components, skipping health check');
      return;
    }
    
    // Check if we're stale - increase to 10 minutes
    const isConnectionStale = this.lastEventTime > 0 && (Date.now() - this.lastEventTime > 10 * 60 * 1000);
    
    if (forceReconnect || (!this.isConnected() && this.connectionCount > 0) || isConnectionStale) {
      if (this.isReconnecting) {
        this.log('🔄 PusherManager: Already reconnecting during health check');
        return;
      }
      
      this.log('🔄 PusherManager: Connection health check failed, reconnecting', {
        forceReconnect,
        isConnected: this.isConnected(),
        isConnectionStale,
        connectionCount: this.connectionCount
      });
      
      this.reconnect();
    }
  }

  static getInstance(): PusherManager {
    if (!PusherManager.instance) {
      PusherManager.instance = new PusherManager();
    }
    return PusherManager.instance;
  }
  
  // Call this method when component unmounts to clean up resources
  cleanup() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    if (this.disconnectTimeout) {
      clearTimeout(this.disconnectTimeout);
    }
    
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    
    if (this.channel) {
      this.channel.unbind_all();
      pusherClient.unsubscribe('canvas');
    }
    
    pusherClient.disconnect();
  }

  // Modified method to register a component that needs a connection
  addConnection() {
    this.connectionCount++;
    this.log(`➕ PusherManager: Component added connection, count: ${this.connectionCount}`);
    
    // Ensure we're connected if at least one component needs it
    if (this.connectionCount === 1 && !this.isConnected()) {
      this.reconnect();
    }
    
    return this.connectionCount;
  }
  
  // Method to unregister a component
  removeConnection() {
    this.connectionCount = Math.max(0, this.connectionCount - 1);
    this.log(`➖ PusherManager: Component removed connection, count: ${this.connectionCount}`);
    
    // Consider disconnecting if no components need the connection
    // We'll keep the connection for up to 60 seconds after last component disconnects
    if (this.connectionCount === 0) {
      if (this.disconnectTimeout) {
        clearTimeout(this.disconnectTimeout);
      }
      
      this.disconnectTimeout = setTimeout(() => {
        if (this.connectionCount === 0) {
          this.log('🔌 PusherManager: No active components, disconnecting');
          pusherClient.disconnect();
        }
      }, 60000); // Keep connection for 60 seconds
    }
    
    return this.connectionCount;
  }
}

export const pusherManager = PusherManager.getInstance(); 