/**
 * Environment utility functions for consistent environment detection
 */

/**
 * Is this the hosted version of the application
 */
export const isHosted =
  process.env.NEXT_PUBLIC_APP_URL === "https://market.tradinggoose.ai" ||
