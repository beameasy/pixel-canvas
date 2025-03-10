# Project Architecture

## Overview
This document describes the high-level architecture of our pixel placement application.

## System Components
1. **Frontend (Next.js)**
   - Canvas rendering and interaction
   - User authentication via Privy
   - Admin tools

2. **Backend (Next.js API Routes)**
   - Pixel placement and retrieval
   - User management
   - Admin functions

3. **Data Storage (Redis)**
   - Canvas state
   - User data
   - Rate limiting
   - Admin lists

4. **Real-time Updates (Pusher)**
   - Canvas updates
   - User activity

## Architecture Diagram 