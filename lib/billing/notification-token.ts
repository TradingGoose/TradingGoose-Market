import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getMarketRuntimeConfig } from "@/lib/environment";

function digest(email: string, salt: string) {
  return createHash("sha256").update(`${email}:${salt}:notifications:${getMarketRuntimeConfig().betterAuth.secret}`).digest();
}

export function notificationToken(email: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${digest(email, salt).toString("hex")}:notifications`;
}

export function validNotificationToken(email: string, token: string) {
  const match = /^([a-f0-9]{32}):([a-f0-9]{64}):notifications$/.exec(token);
  return !!match && timingSafeEqual(digest(email, match[1]), Buffer.from(match[2], "hex"));
}
