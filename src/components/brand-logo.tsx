import Image from 'next/image';
import { cn } from '@/lib/utils';

/** Navy wordmark, for light surfaces. */
const LIGHT_LOGO = {
  src: '/ConverMesh%20Navy%20and%20Teal%20Logo.png',
  ratio: 2000 / 660,
};
/** White wordmark, for dark surfaces. */
const DARK_LOGO = {
  src: '/ConverMesh-transparent-background.png',
  ratio: 2000 / 642,
};

/**
 * Rendered height = `height` prop x LOGO_SCALE. The logo previously displayed
 * at ~1.54x the prop (next/image picked its own intrinsic size), so 2.0 is
 * that same size plus 30% (28 -> 56px).
 */
const LOGO_SCALE = 2;

interface BrandLogoProps {
  height?: number;
  className?: string;
  priority?: boolean;
  /** Always use the dark-surface logo (e.g. the navy sidebar, which stays navy in light mode). */
  onDark?: boolean;
}

function LogoImage({
  logo,
  height,
  priority,
  className,
}: {
  logo: typeof LIGHT_LOGO;
  height: number;
  priority: boolean;
  className?: string;
}) {
  const scaledHeight = Math.round(height * LOGO_SCALE);
  return (
    <Image
      src={logo.src}
      alt="ConverMesh"
      width={Math.round(scaledHeight * logo.ratio)}
      height={scaledHeight}
      priority={priority}
      style={{ height: scaledHeight, width: 'auto' }}
      className={cn('max-w-none', className)}
    />
  );
}

export function BrandLogo({
  height = 32,
  className,
  priority = false,
  onDark = false,
}: BrandLogoProps) {
  if (onDark) {
    return (
      <LogoImage
        logo={DARK_LOGO}
        height={height}
        priority={priority}
        className={className}
      />
    );
  }

  // Both are rendered; CSS shows the one matching the active theme, so there
  // is no flash of the wrong logo before React hydrates.
  return (
    <>
      <LogoImage
        logo={LIGHT_LOGO}
        height={height}
        priority={priority}
        className={cn('dark:hidden', className)}
      />
      <LogoImage
        logo={DARK_LOGO}
        height={height}
        priority={priority}
        className={cn('hidden dark:block', className)}
      />
    </>
  );
}
