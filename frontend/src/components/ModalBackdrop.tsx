/**
 * `raised` lifts the modal further off the page — a stronger shadow and a
 * dimmer backdrop — for modals the user did not open themselves.
 */
export type ModalElevation = 'default' | 'raised';

const dimClasses: Record<ModalElevation, string> = {
  default: 'bg-black/50',
  raised: 'bg-black/60',
};

interface ModalBackdropProps {
  onClick: () => void;
  elevation?: ModalElevation;
  /**
   * Backdrops blur the page behind them by default. Opt out only where the
   * blur has nothing to act on or actively hurts — e.g. over content that is
   * already fully obscured, or where the cost of compositing a full-screen
   * blur is not worth it.
   */
  blurBackdrop?: boolean;
}

export function ModalBackdrop({
  onClick,
  elevation = 'default',
  blurBackdrop = true,
}: ModalBackdropProps) {
  const blurClass = blurBackdrop ? 'backdrop-blur-[2px]' : '';

  return (
    <div
      className={`absolute inset-0 ${dimClasses[elevation]} ${blurClass}`}
      aria-hidden="true"
      onClick={onClick}
    />
  );
}
