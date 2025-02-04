'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useState } from 'react';

interface HeaderProps {
  authenticated: boolean;
  onLogin: () => void;
  onLogout: () => void;
  userAddress?: string;
  showError: boolean;
  children?: React.ReactNode;
}

export default function Header({ children, authenticated, onLogin, onLogout, showError }: HeaderProps) {
  const { login, authenticated: privyAuthenticated, user, logout } = usePrivy();
  const [showDisconnect, setShowDisconnect] = useState(false);

  return (
    <header className="sticky top-8">
      {children}
    </header>
  );
} 