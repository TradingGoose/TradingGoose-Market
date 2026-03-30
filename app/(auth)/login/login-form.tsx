"use client";

import { useMemo, useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type LoginFormProps = {
  showSignupLink: boolean;
};

export default function LoginForm({ showSignupLink }: LoginFormProps) {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const callbackUrl = useMemo(() => {
    const candidate = searchParams.get("callbackUrl") ?? searchParams.get("redirect");
    if (!candidate || !candidate.startsWith("/admin")) {
      return "/admin";
    }
    return candidate;
  }, [searchParams]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;

    setError(null);
    setIsSubmitting(true);

    try {
      const { error: signInError } = await authClient.signIn.email({
        email,
        password,
        callbackURL: callbackUrl
      });

      if (signInError) {
        setError(signInError.message ?? "Unable to sign in.");
        return;
      }
      window.location.assign(callbackUrl as Route);
    } catch {
      setError("Unable to sign in.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-primary">TradingGoose Admin</CardTitle>
          <CardDescription className="text-secondary-foreground">
            Sign in with TradingGoose-Market Admin credentials.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? "Signing in..." : "Sign in"}
            </Button>
            {showSignupLink ? (
              <p className="text-center text-sm text-muted-foreground">
                Need an account?{" "}
                <Link className="font-medium text-primary hover:underline" href="/signup">
                  Sign up
                </Link>
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
