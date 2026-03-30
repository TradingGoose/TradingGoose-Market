export function getFromEmailAddress(): string {
  return process.env.FROM_EMAIL_ADDRESS || "noreply@tradinggoose.com";
}

export function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}
