import { pusherClient } from './pusher';

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
  private reconnectTimeout: any = null;
  private reconnectDebounceTimeout: any = null;
  // Track whether we should be actively trying to maintain a connection
  private connectionNeeded: boolean = false;
  // Track components that have requested a connection
  private connectionRequests: Set<string> = new Set();

  private constructor() {
    // Initialize with no immediate connection - wait until a component needs it
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
    
    // Health check interval is still useful but less frequent
    this.healthCheckInterval = setInterval(() => this.checkConnectionHealth(), 30000);
  }

  private handleVisibilityChange = () => {
    if (document.visibilityState === 'visible' && this.connectionNeeded) {
      // Only check connection if we actually need it
      if (this.connectionRequests.size > 0) {
        console.log('🔄 PusherManager: Page became visible, checking connection');
        this.checkConnectionHealth(true);
      }
    }
  };

  private initializeChannel() {
    // Don't initialize if no components need the connection
    if (this.connectionRequests.size === 0) {
      console.log('🔄 PusherManager: No active connection requests, skipping initialization');
      return;
    }
    
    console.log('🔄 PusherManager: Initializing channel');
    
    try {
      if (this.channel) {
        console.log('🔄 PusherManager: Unbinding existing channel');
        // Safely unbind all events
        try {
          this.channel.unbind_all();
        } catch (e) {
          console.warn('🔄 PusherManager: Error unbinding channel events', e);
        }
        
        // Safely unsubscribe
        try {
          pusherClient.unsubscribe('canvas');
        } catch (e) {
          console.warn('🔄 PusherManager: Error unsubscribing from channel', e);
        }
      }
      
      // Only disconnect if we're not already disconnected
      if (pusherClient.connection.state !== 'disconnected' && 
          pusherClient.connection.state !== 'connecting') {
        console.log('🔄 PusherManager: Disconnecting Pusher client');
        try {
          pusherClient.disconnect();
        } catch (e) {
          console.warn('🔄 PusherManager: Error disconnecting client', e);
        }
      }
      
      console.log('🔄 PusherManager: Connecting Pusher client');
      try {
        pusherClient.connect();
      } catch (e) {
        console.warn('🔄 PusherManager: Error connecting client', e);
        // If we can't connect, try again after a delay
        setTimeout(() => this.debouncedReconnect(), 2000);
        return;
      }
      
      console.log('🔄 PusherManager: Subscribing to channel');
      try {
        this.channel = pusherClient.subscribe('canvas');
      } catch (e) {
        console.warn('🔄 PusherManager: Error subscribing to channel', e);
        // If we can't subscribe, try again after a delay
        setTimeout(() => this.debouncedReconnect(), 2000);
        return;
      }
      
      // Monitor connection state changes
      pusherClient.connection.bind('state_change', (states: { current: string, previous: string }) => {
        console.log(`📡 PusherManager: Connection state changed from ${states.previous} to ${states.current}`);
        
        if (states.current === 'connected') {
          this.reconnectAttempts = 0;
          this.isReconnecting = false;
          this.onConnectionEstablished();
        } else if (states.current === 'disconnected' || states.current === 'failed') {
          // If we disconnect or fail, try to reconnect after a short delay
          if (!this.isReconnecting && this.connectionNeeded) {
            this.debouncedReconnect();
          }
        }
      });
      
      this.channel.bind('pusher:subscription_succeeded', () => {
        console.log('✅ PusherManager: Channel subscription succeeded');
        this.subscribed = true;
        this.rebindHandlers();
      });
      
      // Add subscription error handling
      this.channel.bind('pusher:subscription_error', (error: any) => {
        console.error('❌ PusherManager: Channel subscription failed', error);
        this.subscribed = false;
        
        // Attempt to recover with debounce
        this.debouncedReconnect();
      });
    } catch (e) {
      console.error('🚨 PusherManager: Unexpected error in initializeChannel', e);
      // If there's an unexpected error, wait and try again
      setTimeout(() => this.debouncedReconnect(), 3000);
    }
  }

  private debouncedReconnect() {
    // Clear any existing reconnect timeout
    if (this.reconnectDebounceTimeout) {
      clearTimeout(this.reconnectDebounceTimeout);
    }
    
    if (!this.connectionNeeded) {
      console.log('🔄 PusherManager: Connection not needed, skipping reconnect');
      return;
    }
    
    console.log('🔄 PusherManager: Scheduling debounced reconnect');
    this.isReconnecting = true;
    
    // Set a longer debounce timeout to avoid quick connection/disconnection cycles
    this.reconnectDebounceTimeout = setTimeout(() => {
      console.log('🔄 PusherManager: Executing debounced reconnect');
      this.reconnect();
    }, 3000); // Longer 3-second debounce
  }

  private onConnectionEstablished() {
    console.log('✅ PusherManager: Connection established, setting up ping');
    
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
    
    console.log(`🔁 PusherManager: Rebinding handlers for ${this.eventHandlers.size} events`);
    
    this.eventHandlers.forEach((handlers, eventName) => {
      console.log(`🔁 PusherManager: Rebinding ${handlers.size} handlers for event '${eventName}'`);
      handlers.forEach(handler => {
        this.channel.bind(eventName, (data: any) => {
          // Update last event time whenever we receive any event
          this.lastEventTime = Date.now();
          handler(data);
        });
      });
    });
  }

  // Register a component that needs a Pusher connection
  registerConnectionRequest(componentId: string) {
    console.log(`➕ PusherManager: Component ${componentId} requested connection`);
    this.connectionRequests.add(componentId);
    
    if (!this.connectionNeeded) {
      this.connectionNeeded = true;
      // If this is our first request, initialize the channel
      this.initializeChannel();
    } else if (!this.isConnected()) {
      // If we already need a connection but aren't connected, check health
      this.checkConnectionHealth(true);
    }
  }
  
  // Unregister a component that no longer needs the connection
  unregisterConnectionRequest(componentId: string) {
    console.log(`➖ PusherManager: Component ${componentId} unregistered connection`);
    this.connectionRequests.delete(componentId);
    
    // If no more components need connection, disconnect after a delay
    if (this.connectionRequests.size === 0) {
      console.log('🔄 PusherManager: No more connection requests, scheduling disconnection');
      
      // Wait 30 seconds before disconnecting to handle temporary navigation
      setTimeout(() => {
        if (this.connectionRequests.size === 0) {
          console.log('🔄 PusherManager: Disconnecting due to inactivity');
          this.connectionNeeded = false;
          pusherClient.disconnect();
        }
      }, 30000);
    }
  }

  subscribe(eventName: string, callback: (data: any) => void, componentId: string = 'unknown') {
    console.log(`➕ PusherManager: Subscribing to event '${eventName}' for ${componentId}`);
    
    // Register that this component needs a connection
    this.registerConnectionRequest(componentId);
    
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
    } else {
      console.log(`⚠️ PusherManager: Channel not subscribed yet, event '${eventName}' will be bound later`);
      // If we're not subscribed yet, make sure we're trying to connect
      this.checkConnectionHealth(true);
    }
  }

  unsubscribe(eventName: string, callback: (data: any) => void, componentId: string = 'unknown') {
    console.log(`➖ PusherManager: Unsubscribing from event '${eventName}' for ${componentId}`);
    
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
    
    // Unregister this component's need for connection
    this.unregisterConnectionRequest(componentId);
  }

  reconnect() {
    // Don't reconnect if no components need the connection
    if (this.connectionRequests.size === 0) {
      console.log('🔄 PusherManager: No active connection requests, skipping reconnect');
      this.connectionNeeded = false;
      this.isReconnecting = false;
      return;
    }
    
    if (this.isReconnecting && this.reconnectTimeout) {
      console.log('🔄 PusherManager: Already reconnecting, skipping duplicate attempt');
      return;
    }
    
    this.isReconnecting = true;
    
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('⛔ PusherManager: Maximum reconnection attempts reached');
      return;
    }
    
    // Use exponential backoff with a cap of 10 seconds
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 10000);
    this.reconnectAttempts++;
    
    console.log(`🔄 PusherManager: Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    this.subscribed = false;
    
    // Safely clean up existing connections
    try {
      // Completely disconnect and unsubscribe first
      if (this.channel) {
        try {
          this.channel.unbind_all();
        } catch (e) {
          console.warn('🔄 PusherManager: Error unbinding channel events during reconnect', e);
        }
        
        try {
          pusherClient.unsubscribe('canvas');
        } catch (e) {
          console.warn('🔄 PusherManager: Error unsubscribing channel during reconnect', e);
        }
      }
      
      // Force disconnect pusher client
      if (pusherClient.connection.state !== 'disconnected') {
        try {
          pusherClient.disconnect();
        } catch (e) {
          console.warn('🔄 PusherManager: Error disconnecting during reconnect', e);
        }
      }
    } catch (e) {
      console.error('🚨 PusherManager: Unexpected error during reconnect cleanup', e);
    }
    
    // Clear any existing reconnect timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      console.log('🔄 PusherManager: Executing reconnect after delay');
      this.initializeChannel();
    }, delay);
  }

  isConnected() {
    return this.channel?.subscribed && pusherClient.connection.state === 'connected';
  }

  private checkConnectionHealth(forceReconnect = false) {
    // Skip health check if no connection is needed
    if (!this.connectionNeeded && !forceReconnect) {
      return;
    }
    
    // Connection status
    const connectionStatus = {
      isSubscribed: !!this.channel?.subscribed,
      connectionState: pusherClient.connection.state,
      timeSinceLastEvent: this.lastEventTime > 0 ? Date.now() - this.lastEventTime : 0,
      reconnectAttempts: this.reconnectAttempts,
      connectionRequests: this.connectionRequests.size,
      connectionNeeded: this.connectionNeeded
    };
    
    console.log('🔍 PusherManager: Connection health check', connectionStatus);
    
    // Check if we're stale - no events for 5 minutes
    const isConnectionStale = this.lastEventTime > 0 && (Date.now() - this.lastEventTime > 5 * 60 * 1000);
    
    if (forceReconnect || 
        (this.connectionNeeded && !this.isConnected()) || 
        (this.connectionNeeded && isConnectionStale)) {
      if (this.isReconnecting) {
        console.log('🔄 PusherManager: Already reconnecting during health check');
        return;
      }
      
      console.log('🔄 PusherManager: Connection health check failed, reconnecting', {
        forceReconnect,
        isConnected: this.isConnected(),
        isConnectionStale,
        connectionNeeded: this.connectionNeeded
      });
      
      this.debouncedReconnect();
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
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    
    if (this.reconnectDebounceTimeout) {
      clearTimeout(this.reconnectDebounceTimeout);
    }
    
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    
    this.connectionRequests.clear();
    this.connectionNeeded = false;
    
    if (this.channel) {
      this.channel.unbind_all();
      pusherClient.unsubscribe('canvas');
    }
    
    pusherClient.disconnect();
  }
}

export const pusherManager = PusherManager.getInstance(); 