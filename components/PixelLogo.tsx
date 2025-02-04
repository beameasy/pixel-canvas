interface PixelLogoProps {
  className?: string;
}

export default function PixelLogo({ className = '' }: PixelLogoProps) {
  return (
    <div className={`text-center ${className}`}>
      <div 
        className="font-mono text-[#FFD700] text-xl inline-block"
        style={{
          fontFamily: 'monospace',
          lineHeight: 1.2,
          letterSpacing: 0,
          whiteSpace: 'pre',
          userSelect: 'none'
        }}
      >{`
█▀▀▄ █ █   █   █▀▀▄ █▀▀█ █▀▀█ █▀▀█ █▀▀▄
█▀▀▄ █ █   █   █▀▀▄ █  █ █▀▀█ █▀▀█ █  █
▀▀▀  █ ▀▀▀ ▀▀▀ ▀▀▀  ▀▀▀▀ ▀  ▀    █ ▀▀▀ 
`}</div>
    </div>
  );
}