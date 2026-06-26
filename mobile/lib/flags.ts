// Launch feature flags.
//
// PAYMENTS_ENABLED is parked OFF for the first launch — we ship GPS virtual-run
// + Strava, and design payments later. While it's off, ALL money UI is hidden
// (club membership-fee config, challenge join-fee field, Plan & billing) so a
// runner can never hit a "Pay" button that dead-ends (the backend gateway is
// dormant too). To bring payments back: set the Razorpay keys on the backend and
// flip this to true, then OTA.
export const PAYMENTS_ENABLED = false;
