# Authentication System

## Overview
This document describes the authentication system used in our pixel placement application. The application uses a combination of wallet-based authentication via Privy and session-based authentication via Supabase.

## Authentication Methods

### 1. Privy Integration (Primary)
- **Purpose**: Provides wallet-based authentication
- **Implementation**: Privy SDK in frontend, token validation in backend
- **User Experience**: Connect wallet button → Wallet selection → Signature request → Authentication
- **Token Type**: JWT with Privy-specific claims

### 2. Supabase Authentication (Secondary)
- **Purpose**: Alternative authentication method and admin access
- **Implementation**: Supabase Auth in frontend, session validation in backend
- **Session Management**: Client-side and server-side session validation

## Authentication Flow

### Wallet Connection Flow
1. User clicks "Connect Wallet" button
2. Privy SDK presents wallet options (MetaMask, WalletConnect, etc.)
3. User selects wallet and confirms connection
4. Wallet signs authentication message
5. Privy issues JWT with wallet address and user ID
6. Frontend stores token and establishes user session
7. Backend validates token for subsequent API requests

### User Identification
- Primary identifier: Wallet address (lowercase)
- Secondary identifier: Privy ID
- Mapping stored in Redis `users` hash

### Token Validation Process
1. Client includes Privy token in `x-privy-token` header
2. Middleware extracts and decodes token
3. Token payload contains Privy user ID
4. System looks up wallet address by Privy ID in Redis
5. If found, request authenticated with wallet address
6. If not found, authentication fails

## Authorization Levels

### 1. Public Routes
- **Access**: Anyone, no authentication required
- **Examples**: 
  - `GET /api/pixels`: View canvas
  - `GET /api/canvas`: Get canvas state
  - `GET /api/users/balance`: Check token balance
  - `GET /api/users/check-profile`: Check if profile exists
  - `GET /api/farcaster`: Farcaster integration
  - `GET /api/pixels/history`: View pixel history
  - `GET /api/ticker`: Get token price

### 2. Protected Routes
- **Access**: Authenticated users only
- **Examples**:
  - `POST /api/pixels`: Place a pixel
  - `POST /api/users/check-profile`: Update profile

### 3. Admin Routes
- **Access**: Admin users only
- **Examples**:
  - `/api/admin/*`: All admin endpoints

## Implementation Details

### Middleware Protection
The application uses a middleware-based approach to protect routes:
