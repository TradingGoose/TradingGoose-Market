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
    const response = await post("/change-email", {
      newEmail,
      ...(redirect ? { callbackURL: "/account/api-keys?settings=profile" } : {}),
    }, cookie);
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
  async function requestReset(email: string) {
    const response = await post("/request-password-reset", { email, redirectTo: "/reset-password" });
    expect(response.status, await response.clone().text()).toBe(200);
    const message = sent.at(-1);
    if (!message || message.kind !== "password-reset" || !message.url) throw new Error("Reset delivery was not captured.");
    return new URL(message.url).pathname.split("/").at(-1)!;
  }
  async function assertConcurrentFailuresExhaust(email: string) {
    const otp = await sendOtp(email);
    const incorrectOtp = otp === "000000" ? "999999" : "000000";
    const failures = await Promise.all(Array.from({ length: 10 }, () => (
      post("/sign-in/email-otp", { email, otp: incorrectOtp })
    )));
    expect(failures.every((response) => response.status === 400 || response.status === 403)).toBe(true);
    const correctAfterFailures = await post("/sign-in/email-otp", { email, otp });
    expect(correctAfterFailures.status).toBe(400);
    expect(await database`select id from verification where identifier = ${`sign-in-otp-${email}`}`).toHaveLength(0);
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

    // Email-change retirement rolls back with a failed unique-address update.
    const retiringOtp = await sendOtp(originalEmail);
    const retiringReset = await requestReset(originalEmail);
    const unavailableEmail = `occupied-${randomUUID()}@example.com`;
    const rollbackLink = await changeEmail(unavailableEmail, cookie);
    await signup(unavailableEmail, "Occupied after link issuance");
    const failedChange = await verify(rollbackLink);
    expect(failedChange.status).toBe(500);
    expect((await database<{ email: string }[]>`select email from "user" where id = ${aliceId}`)[0].email).toBe(originalEmail);
    expect(await database`select id from verification where identifier = ${`sign-in-otp-${originalEmail}`}`).toHaveLength(1);
    expect(await database`select id from verification where identifier = ${`reset-password:${retiringReset}`}`).toHaveLength(1);
    expect(await database`select id from verification where identifier = ${`change-email-${aliceId}`}`).toHaveLength(1);
    expect(await database`select id from session where user_id = ${aliceId}`).toHaveLength(1);

    // Only the latest link survives; successful verification keeps Alice's ID.
    const supersededEmail = `superseded-${randomUUID()}@example.com`;
    const currentEmail = `current-${randomUUID()}@example.com`;
    const supersededLink = await changeEmail(supersededEmail, cookie, true);
    const currentLink = await changeEmail(currentEmail, cookie);
    const staleCallback = await verify(supersededLink);
    expect(staleCallback.status).toBe(302);
    expect(staleCallback.headers.get("location")).toBe("/account/api-keys?settings=profile&error=invalid_token");
    // Queue verification first behind a real identity row lock, then queue
    // issuance and redemption which have already read the old identity/token.
    // They must recheck after the change wins, not recreate or use old proofs.
    const racing: Promise<Response>[] = [];
    try {
      await database.begin(async (tx) => {
        await tx.unsafe('select id from "user" where id = $1 for update', [aliceId]);
        racing.push(verify(currentLink));
        async function waitForIdentityWaiters(count: number) {
          await vi.waitFor(async () => {
            const waiting = await database`
              select pid from pg_stat_activity
              where datname = current_database() and wait_event_type = 'Lock'
                and query like 'update "user"%'
            `;
            expect(waiting).toHaveLength(count);
          }, { timeout: 5_000 });
        }
        await waitForIdentityWaiters(1);
        racing.push(
          post("/request-password-reset", { email: originalEmail, redirectTo: "/reset-password" }),
          post("/email-otp/send-verification-otp", { email: originalEmail, type: "sign-in" }),
          post("/sign-in/email-otp", { email: originalEmail, otp: retiringOtp }),
          post("/reset-password", { token: retiringReset, newPassword: "Racing-password-must-not-win-123!" }),
        );
        await waitForIdentityWaiters(5);
      });
    } catch (error) {
      await Promise.allSettled(racing);
      throw error;
    }
    const [changed, resetIssuance, otpIssuance, otpRedemption, resetRedemption] = await Promise.all(racing);
    expect(changed.status, await changed.clone().text()).toBe(200);
    expect((await changed.json() as { user: { id: string } }).user.id).toBe(aliceId);
    expect(resetIssuance.status).toBe(200);
    expect(otpIssuance.status).toBe(200);
    expect(otpRedemption.status).toBe(400);
    expect(resetRedemption.status).toBe(400);
    expect(await database`select id from verification where identifier = ${`sign-in-otp-${originalEmail}`}`).toHaveLength(0);
    expect(await database`select id from verification where identifier = ${`reset-password:${retiringReset}`}`).toHaveLength(0);

    // Bob claims the freed email. Neither Alice's older link nor the consumed
    // successful link may change Bob's address or create a session for Bob.
    const bobId = await signup(originalEmail, "Bob");
    expect(bobId).not.toBe(aliceId);
    expect((await verify(supersededLink)).status).toBe(302);
    expect((await verify(currentLink)).status).toBe(401);
    const replayOtp = await post("/sign-in/email-otp", { email: originalEmail, otp: retiringOtp });
    expect(replayOtp.status).toBe(400);
    const [originalCredential] = await database<{ password: string }[]>`select password from account where user_id = ${aliceId} and provider_id = 'credential'`;
    const replayReset = await post("/reset-password", { token: retiringReset, newPassword: "Replayed-password-must-not-win-123!" });
    expect(replayReset.status).toBe(400);
    expect((await database<{ password: string }[]>`select password from account where user_id = ${aliceId} and provider_id = 'credential'`)[0].password).toBe(originalCredential.password);
    expect(await database`select id from session where user_id = ${bobId}`).toHaveLength(0);
    const [bob] = await database<{ email: string }[]>`select email from "user" where id = ${bobId}`;
    expect(bob.email).toBe(originalEmail);
    const [alice] = await database<{ email: string }[]>`select email from "user" where id = ${aliceId}`;
    expect(alice.email).toBe(currentEmail);

    // Every failure counts across workers, including Studio's supported
    // missing-user OTP signup. Neither exhausted challenge creates a session.
    const sessionsBeforeFailures = await database`select id from session where user_id = ${aliceId}`;
    const expiredOtp = await sendOtp(currentEmail);
    await database`update verification set expires_at = now() - interval '1 second' where identifier = ${`sign-in-otp-${currentEmail}`}`;
    const expired = await post("/sign-in/email-otp", { email: currentEmail, otp: expiredOtp });
    expect(expired.status).toBe(400);
    expect(await expired.json()).toMatchObject({ code: "OTP_EXPIRED" });
    await assertConcurrentFailuresExhaust(currentEmail);
    expect(await database`select id from session where user_id = ${aliceId}`).toHaveLength(sessionsBeforeFailures.length);
    const unknownEmail = `otp-only-${randomUUID()}@example.com`;
    await assertConcurrentFailuresExhaust(unknownEmail);
    expect(await database`select id from "user" where email = ${unknownEmail}`).toHaveLength(0);
    const freshUnknownOtp = await sendOtp(unknownEmail);
    expect((await post("/sign-in/email-otp", { email: unknownEmail, otp: freshUnknownOtp })).status).toBe(200);

    // A fresh reset at the new email still uses Better Auth's one-time owner.
    const currentReset = await requestReset(currentEmail);
    expect((await post("/reset-password", { token: currentReset, newPassword: "Current-password-accepted-123!" })).status).toBe(200);
    expect((await post("/reset-password", { token: currentReset, newPassword: "Current-password-replay-123!" })).status).toBe(400);

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
    expect(redirected.headers.get("location")).toBe("/account/api-keys?settings=profile");
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
