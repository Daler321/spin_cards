/** Referral link a friend opens the Mini App with (TZ 8). */
export const referralLink = (botUsername: string, referralCode: string): string =>
  `https://t.me/${botUsername}?startapp=ref_${referralCode}`;

/** The home invite banner waits until the player knows the game (D-162). */
export const INVITE_BANNER_MIN_SPINS = 200;
