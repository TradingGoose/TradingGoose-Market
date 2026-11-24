export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { initializeMarketRuntime } = await import("@/lib/startup");
  await initializeMarketRuntime();
}
