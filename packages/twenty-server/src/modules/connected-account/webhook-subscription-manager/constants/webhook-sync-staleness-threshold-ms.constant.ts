// Five minutes, the polling cadence before push: Google's push has never reached
// this instance, so a sync that only polls after an hour imports mail an hour late.
export const WEBHOOK_SYNC_STALENESS_THRESHOLD_MS = 5 * 60 * 1000;
