import { Banner } from './Banner';

export function PhotoPrivacyNotice() {
  return (
    <Banner tone="notice">
      <p className="text-sm text-center">
        Please don't screenshot, save or share these photos. Thank you!
      </p>
    </Banner>
  );
}
