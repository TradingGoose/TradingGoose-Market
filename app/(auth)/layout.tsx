import { LandingNav } from "@/app/(landing)/components/nav/landing-nav";
import { AuthBackground } from "@/components/auth/auth-background";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthBackground>
      <main className="relative flex min-h-screen flex-col font-geist-sans text-foreground">
        <LandingNav />
        <div className="relative z-30 flex flex-1 items-center justify-center px-4 pb-24 pt-12">
          <div className="w-full max-w-lg px-4">{children}</div>
        </div>
      </main>
    </AuthBackground>
  );
}
