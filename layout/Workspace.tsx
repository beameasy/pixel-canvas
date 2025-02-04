'use client';

interface WorkspaceProps {
  children: React.ReactNode;
}

export default function Workspace({ children }: WorkspaceProps) {
  return (
    <div className="flex justify-center gap-8 w-full">
      {children}
    </div>
  );
} 