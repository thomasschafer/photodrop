import type { CSSProperties, ImgHTMLAttributes } from 'react';

interface ProtectedImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  /** When true, prevents right-click "Save image as" and drag-to-save */
  protected: boolean;
}

// WebKit does not implement unprefixed `user-select` (CSS.supports reports
// false, and setting it is a silent no-op), so the prefixed property must be
// set alongside it or protection does nothing at all in Safari — the platform
// this app is used on most.
const PROTECTED_STYLE: CSSProperties = {
  WebkitTouchCallout: 'none',
  WebkitUserSelect: 'none',
  userSelect: 'none',
};

/**
 * Image component that optionally blocks right-click saving and dragging.
 *
 * When `protected` is true:
 * - onContextMenu is prevented (blocks "Save image as" context menu)
 * - Dragging is disabled (blocks drag-to-desktop saving)
 * - Text selection and iOS long-press callout are disabled
 *
 * This can't stop determined users (dev tools, screenshots) but blocks
 * casual right-click saving for the vast majority of users.
 */
export function ProtectedImage({
  protected: isProtected,
  className,
  style,
  draggable,
  ...imgProps
}: ProtectedImageProps) {
  if (!isProtected) {
    return <img className={className} style={style} draggable={draggable} {...imgProps} />;
  }

  return (
    <img
      {...imgProps}
      className={className}
      style={{ ...style, ...PROTECTED_STYLE }}
      draggable={false}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}
