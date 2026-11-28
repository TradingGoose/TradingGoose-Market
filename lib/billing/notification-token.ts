import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getMarketRuntimeConfig } from "@/lib/environment";

export const notificationTokenPattern = /^([a-f0-9]{32}):([a-f0-9]{64}):notifications$/;

function digest(userId: string, email: string, salt: string) {
  return createHmac("sha256", getMarketRuntimeConfig().betterAuth.secret)
    .update(JSON.stringify([userId, email, salt, "notifications"])).digest();
}

export function notificationToken(userId: string, email: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${digest(userId, email, salt).toString("hex")}:notifications`;
}

export function validNotificationToken(userId: string, email: string, token: string) {
  const match = notificationTokenPattern.exec(token);
  return !!match && timingSafeEqual(digest(userId, email, match[1]), Buffer.from(match[2], "hex"));
}
