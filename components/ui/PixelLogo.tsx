interface PixelLogoProps {
  className?: string;
}

export default function PixelLogo({ className = '' }: PixelLogoProps) {
  return (
    <div className={`text-center mb-1 sm:mb-2 ${className}`}>
      <div 
        className="font-mono text-[#FFD700] text-[0.6rem] xs:text-sm sm:text-base md:text-xl inline-block"
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