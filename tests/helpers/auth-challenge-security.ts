import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { expect, vi } from "vitest";

/** Real HTTP handlers, installed Better Auth, and the migrated PostgreSQL database. */
export async function assertAuthChallengeSecurity(database: ReturnType<typeof postgres>) {
  const [route, mailer] = await Promise.all([
    import("../../app/api/auth/[...all]/route"),
    import("../../lib/auth/mailer"),
  ]);
  const sent: Parameters<typeof mailer.sendMarketAuthEmail>[0][] = [];
  const delivery = vi.spyOn(mailer, "sendMarketAuthEmail").mockImplementation(async (message) => {
    sent.push(message);
  });
  const origin = "http://market.test";
  const originalEmail = `challenge-${randomUUID()}@example.com`;

  async function post(path: string, body: object, cookie?: string) {
    return route.POST(new Request(`${origin}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }));
  }
  async function signup(email: string, name: string) {
    const response = await post("/sign-up/email", {
      name, email, password: "Challenge-security-password-123!",
    });
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json() as { user: { id: string } }).user.id;
  }
  async function sendOtp(email: string) {
    const response = await post("/email-otp/send-verification-otp", { email, type: "sign-in" });
    expect(response.status, await response.clone().text()).toBe(200);
    const message = sent.at(-1);
    if (!message || message.kind !== "sign-in-otp" || !message.otp) throw new Error("OTP delivery was not captured.");
    return message.otp;
  }
  async function changeEmail(newEmail: string, cookie: string, redirect = false) {
    const response = await post("/change-email", { newEmail }, cookie);
    expect(response.status, await response.clone().text()).toBe(200);
    const message = sent.at(-1);
    if (!message || message.kind !== "email-change-verification" || !message.url) throw new Error("Email-change delivery was not captured.");
    const link = new URL(message.url);
    if (!redirect) link.searchParams.delete("callbackURL");
    return link;
  }
  function verify(link: URL) {
    return route.GET(new Request(link));
  }

  try {
    const aliceId = await signup(originalEmail, "Alice");
    const firstOtp = await sendOtp(originalEmail);
    const secondOtp = await sendOtp(originalEmail);
    const challenges = await database<{ value: string }[]>`
      select value from verification where identifier = ${`sign-in-otp-${originalEmail}`}
    `;
    expect(challenges).toEqual([{ value: `${secondOtp}:0` }]);

    const signIn = await post("/sign-in/email-otp", { email: originalEmail, otp: secondOtp });
    expect(signIn.status, await signIn.clone().text()).toBe(200);
    const cookie = signIn.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
    expect(cookie).toContain("session_token=");
    const oldOtp = await post("/sign-in/email-otp", { email: originalEmail, otp: firstOtp });
    expect(oldOtp.status).toBe(400);
    expect(await database`select id from session where user_id = ${aliceId}`).toHaveLength(1);

    // Only the latest link survives; successful verification keeps Alice's ID.
    const supersededEmail = `superseded-${randomUUID()}@example.com`;
    const currentEmail = `current-${randomUUID()}@example.com`;
    const supersededLink = await changeEmail(supersededEmail, cookie);
    const currentLink = await changeEmail(currentEmail, cookie);
    expect((await verify(supersededLink)).status).toBe(401);
    const changed = await verify(currentLink);
    expect(changed.status, await changed.clone().text()).toBe(200);
    expect((await changed.json() as { user: { id: string } }).user.id).toBe(aliceId);

    // Bob claims the freed email. Neither Alice's older link nor the consumed
    // successful link may change Bob's address or create a session for Bob.
    const bobId = await signup(originalEmail, "Bob");
    expect(bobId).not.toBe(aliceId);
    expect((await verify(supersededLink)).status).toBe(401);
    expect((await verify(currentLink)).status).toBe(401);
    expect(await database`select id from session where user_id = ${bobId}`).toHaveLength(0);
    const [bob] = await database<{ email: string }[]>`select email from "user" where id = ${bobId}`;
    expect(bob.email).toBe(originalEmail);
    const [alice] = await database<{ email: string }[]>`select email from "user" where id = ${aliceId}`;
    expect(alice.email).toBe(currentEmail);

    // Concurrent OTP redemption is single-use through the actual adapter, not
    // merely a mocked find-then-delete sequence.
    const concurrentOtp = await sendOtp(currentEmail);
    const signIns = await Promise.all([
      post("/sign-in/email-otp", { email: currentEmail, otp: concurrentOtp }),
      post("/sign-in/email-otp", { email: currentEmail, otp: concurrentOtp }),
    ]);
    expect(signIns.map((response) => response.status).sort()).toEqual([200, 400]);

    // Commit the identity/challenge/session transaction before a success
    // redirect, and serialize duplicate email-link redemption across workers.
    const finalEmail = `final-${randomUUID()}@example.com`;
    const nextLink = await changeEmail(finalEmail, cookie);
    const changes = await Promise.all([verify(nextLink), verify(nextLink)]);
    expect(changes.map((response) => response.status).sort()).toEqual([200, 401]);
    expect(await database`select id from verification where identifier = ${`change-email-${aliceId}`}`).toHaveLength(0);
    const [finalAlice] = await database<{ email: string }[]>`select email from "user" where id = ${aliceId}`;
    expect(finalAlice.email).toBe(finalEmail);

    const redirectEmail = `redirect-${randomUUID()}@example.com`;
    const redirectLink = await changeEmail(redirectEmail, cookie, true);
    const redirected = await verify(redirectLink);
    expect(redirected.status).toBe(302);
    expect(redirected.headers.get("location")).toBe("/");
    const [redirectAlice] = await database<{ email: string }[]>`select email from "user" where id = ${aliceId}`;
    expect(redirectAlice.email).toBe(redirectEmail);
    const session = await route.GET(new Request(`${origin}/api/auth/get-session`, { headers: { cookie } }));
    expect(session.status).toBe(200);
    expect((await session.json() as { user: { id: string; email: string } }).user).toMatchObject({
      id: aliceId, email: redirectEmail,
    });
  } finally {
    delivery.mockRestore();
  }
}
