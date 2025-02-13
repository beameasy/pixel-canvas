interface WorkspaceProps {
  children: React.ReactNode;
  className?: string;
}

export default function Workspace({ children, className = '' }: WorkspaceProps) {
  return (
    <div className={className}>
      {children}
    </div>
  );
} 