/** Browser-only wizard walkthrough. Never enabled in production builds. */
export const onboardingPreviewEnabled =
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get('onboardingPreview') === '1';
