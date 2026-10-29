"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, KeyRound, Loader2, Mail, RefreshCw, Trash2, Upload, UserRound } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth/client";
import type { EmailChangeCallbackState } from "@/lib/auth/email-change-callback";

type ProfileUser = { id: string; name: string; email: string; image?: string | null };
type Status = { kind: "success" | "error"; message: string } | null;
type NameState = { userId: string; authoritativeName: string; draftName: string; savedName: string };
type EmailDeliveryState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "duplicate" }
  | { kind: "invalid" }
  | { kind: "failed" };

function callbackMessage(state: EmailChangeCallbackState, email: string) {
  switch (state.kind) {
    case "none":
      return null;
    case "refreshing":
      return { kind: "pending" as const, message: "Verification succeeded. Refreshing your account email…" };
    case "verified":
      return { kind: "success" as const, message: `Your verified account email is now ${email}.` };
    case "expired":
      return { kind: "error" as const, message: "That email verification link has expired. Request a new link below." };
    case "unauthorized":
      return { kind: "error" as const, message: "That verification link does not belong to this signed-in account." };
    case "refresh-error":
      return { kind: "error" as const, message: "Verification succeeded, but the updated account session could not be loaded." };
    case "invalid":
      return { kind: "error" as const, message: "That email verification link is invalid or has already been used." };
  }
}

function deliveryMessage(state: EmailDeliveryState) {
  switch (state.kind) {
    case "idle":
    case "sending":
      return null;
    case "sent":
      return { kind: "success" as const, message: "Verification sent to the new address. Your current email remains active until verification succeeds." };
    case "duplicate":
      return { kind: "error" as const, message: "That email address already belongs to an account." };
    case "invalid":
      return { kind: "error" as const, message: "Enter a different valid email address." };
    case "failed":
      return { kind: "error" as const, message: "Unable to send the verification email. Try again." };
  }
}

function classifyDeliveryError(error: unknown): EmailDeliveryState {
  const candidate = error as { code?: unknown; message?: unknown; status?: unknown } | null;
  const code = typeof candidate?.code === "string" ? candidate.code.toLowerCase() : "";
  const message = typeof candidate?.message === "string" ? candidate.message.toLowerCase() : "";
  if (candidate?.status === 422 || code.includes("already_exists") || message.includes("already exists")) {
    return { kind: "duplicate" };
  }
  if (candidate?.status === 400 || code.includes("invalid") || message.includes("valid email")) {
    return { kind: "invalid" };
  }
  return { kind: "failed" };
}

export function ProfileSettings({ user, emailChangeState, onRetryEmailChange, onRefreshUser }: {
  user: ProfileUser;
  emailChangeState: EmailChangeCallbackState;
  onRetryEmailChange: () => Promise<void>;
  onRefreshUser: () => Promise<ProfileUser | null>;
}) {
  const [nameState, setNameState] = useState<NameState>({
    userId: user.id,
    authoritativeName: user.name,
    draftName: user.name,
    savedName: user.name,
  });
  const [newEmail, setNewEmail] = useState(user.email);
  const [nameStatus, setNameStatus] = useState<Status>(null);
  const [emailDelivery, setEmailDelivery] = useState<EmailDeliveryState>({ kind: "idle" });
  const [pendingNameRefresh, setPendingNameRefresh] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [optimisticImage, setOptimisticImage] = useState<string | null | undefined>(undefined);
  const [imageStatus, setImageStatus] = useState<Status>(null);
  const [pendingImageRefresh, setPendingImageRefresh] = useState<string | null | undefined>(undefined);
  const [savingImage, setSavingImage] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  if (nameState.userId !== user.id || nameState.authoritativeName !== user.name) {
    const sameUser = nameState.userId === user.id;
    setNameState({
      userId: user.id,
      authoritativeName: user.name,
      draftName: sameUser && nameState.draftName !== nameState.savedName ? nameState.draftName : user.name,
      savedName: user.name,
    });
  }

  function clearSelectedImage() {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
    setSelectedImage(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  function rejectSelectedImage() {
    clearSelectedImage();
    setOptimisticImage(undefined);
    setPendingImageRefresh(undefined);
    setImageStatus({ kind: "error", message: "Unable to upload that profile picture. Try again." });
  }

  function selectImage(file: File | null) {
    if (!file || pendingImageRefresh !== undefined) return;
    if ((file.type !== "image/png" && file.type !== "image/jpeg") || file.size === 0 || file.size > 5 * 1024 * 1024) {
      clearSelectedImage();
      setImageStatus({ kind: "error", message: "Choose a PNG or JPEG image no larger than 5 MiB." });
      return;
    }
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = URL.createObjectURL(file);
    setPreviewUrl(previewUrlRef.current);
    setSelectedImage(file);
    setImageStatus(null);
  }

  async function reconcileImage(expectedImage: string | null) {
    const refreshed = await onRefreshUser();
    if (!refreshed || refreshed.id !== user.id || (refreshed.image ?? null) !== expectedImage) {
      setPendingImageRefresh(expectedImage);
      setImageStatus({ kind: "error", message: "The picture change was accepted, but the updated account session could not be loaded." });
      return;
    }
    setPendingImageRefresh(undefined);
    setOptimisticImage(undefined);
    setImageStatus({ kind: "success", message: expectedImage ? "Your profile picture was updated." : "Your profile picture was removed." });
  }

  async function uploadImage() {
    if (!selectedImage || savingImage || pendingImageRefresh !== undefined) return;
    setSavingImage(true);
    setImageStatus(null);
    setPendingImageRefresh(undefined);
    const body = new FormData();
    body.set("file", selectedImage);
    try {
      const response = await fetch("/api/account/profile/image", { method: "POST", body });
      const payload = await response.json().catch(() => null) as { image?: unknown } | null;
      if (!response.ok || typeof payload?.image !== "string") {
        rejectSelectedImage();
        return;
      }
      clearSelectedImage();
      setOptimisticImage(payload.image);
      await reconcileImage(payload.image);
    } catch {
      rejectSelectedImage();
    } finally {
      setSavingImage(false);
    }
  }

  async function removeImage() {
    if (savingImage || pendingImageRefresh !== undefined) return;
    setSavingImage(true);
    setImageStatus(null);
    setPendingImageRefresh(undefined);
    try {
      const response = await fetch("/api/account/profile/image", { method: "DELETE" });
      if (!response.ok) {
        setImageStatus({ kind: "error", message: "Unable to remove your profile picture. Try again." });
        return;
      }
      clearSelectedImage();
      setOptimisticImage(null);
      await reconcileImage(null);
    } catch {
      setImageStatus({ kind: "error", message: "Unable to remove your profile picture. Try again." });
    } finally {
      setSavingImage(false);
    }
  }

  async function retryImageRefresh() {
    if (pendingImageRefresh === undefined || savingImage) return;
    setSavingImage(true);
    setImageStatus(null);
    try {
      await reconcileImage(pendingImageRefresh);
    } finally {
      setSavingImage(false);
    }
  }

  async function reconcileName(expectedName: string) {
    const refreshed = await onRefreshUser();
    if (!refreshed || refreshed.id !== user.id || refreshed.name !== expectedName) {
      setPendingNameRefresh(expectedName);
      setNameStatus({ kind: "error", message: "The name update was accepted, but the updated account session could not be loaded." });
      return;
    }
    setPendingNameRefresh(null);
    setNameState((current) => ({
      ...current,
      userId: refreshed.id,
      draftName: refreshed.name,
      savedName: refreshed.name,
    }));
    setNameStatus({ kind: "success", message: "Your name was updated." });
  }

  async function saveName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = nameState.draftName.trim();
    if (!trimmed) {
      setNameStatus({ kind: "error", message: "Name cannot be empty." });
      return;
    }
    setSavingName(true);
    setNameStatus(null);
    setPendingNameRefresh(null);
    try {
      const result = await authClient.updateUser({ name: trimmed });
      if (result.error) {
        setNameStatus({ kind: "error", message: "Unable to update your name." });
        return;
      }
      await reconcileName(trimmed);
    } catch {
      setNameStatus({ kind: "error", message: "Unable to update your name." });
    } finally {
      setSavingName(false);
    }
  }

  async function retryNameRefresh() {
    if (!pendingNameRefresh || savingName) return;
    setSavingName(true);
    setNameStatus(null);
    try {
      await reconcileName(pendingNameRefresh);
    } finally {
      setSavingName(false);
    }
  }

  async function changeEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const normalized = newEmail.trim().toLowerCase();
    const emailInput = form.elements.namedItem("newEmail");
    if (
      !(emailInput instanceof HTMLInputElement) ||
      !emailInput.checkValidity() ||
      !normalized ||
      normalized === user.email.toLowerCase()
    ) {
      setEmailDelivery({ kind: "invalid" });
      return;
    }
    setEmailDelivery({ kind: "sending" });
    try {
      const result = await authClient.changeEmail({
        newEmail: normalized,
        callbackURL: `${window.location.origin}/account/api-keys?emailChange=verified`,
      });
      if (result.error) {
        setEmailDelivery(classifyDeliveryError(result.error));
        return;
      }
      setEmailDelivery({ kind: "sent" });
    } catch {
      setEmailDelivery({ kind: "failed" });
    }
  }

  const callbackNotice = callbackMessage(emailChangeState, user.email);
  const emailNotice = deliveryMessage(emailDelivery);
  const sendingVerification = emailDelivery.kind === "sending";
  const displayedImage = previewUrl ?? (optimisticImage === undefined ? user.image : optimisticImage);
  const imageMutationLocked = savingImage || pendingImageRefresh !== undefined;

  return (
    <div className="space-y-4">
      {callbackNotice ? (
        <Alert variant={callbackNotice.kind === "success" ? "success" : callbackNotice.kind === "error" ? "destructive" : "info"}>
          {callbackNotice.kind === "pending" ? <Loader2 className="animate-spin" /> : null}
          <AlertDescription>{callbackNotice.message}</AlertDescription>
          {emailChangeState.kind === "refresh-error" ? (
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void onRetryEmailChange()}>
              <RefreshCw />Retry account refresh
            </Button>
          ) : null}
        </Alert>
      ) : null}
      <Card className="border-none shadow-none">
        <CardHeader className="space-y-1 px-0 pb-5 pt-0">
          <CardTitle className="flex items-center gap-2 text-lg font-semibold">
            <UserRound className="size-4" aria-hidden="true" />
            Profile details
          </CardTitle>
          <CardDescription>Manage the identity used by your TradingGoose Market account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 p-0">
          <section className="space-y-3" aria-labelledby="profile-picture-heading">
            <div>
              <Label id="profile-picture-heading" className="font-semibold">Profile picture</Label>
              <p className="text-xs text-muted-foreground">PNG or JPEG, up to 5 MiB.</p>
            </div>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <button
                type="button"
                className="group relative rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                onClick={() => fileInput.current?.click()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => { event.preventDefault(); selectImage(event.dataTransfer.files[0] ?? null); }}
                aria-label="Choose a profile picture"
                disabled={imageMutationLocked}
              >
                <Avatar className="size-20 border">
                  {displayedImage ? <AvatarImage src={displayedImage} alt="" /> : null}
                  <AvatarFallback className="text-xl">{user.name.trim().charAt(0).toUpperCase() || "U"}</AvatarFallback>
                </Avatar>
                <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100"><Camera className="size-5" /></span>
              </button>
              <input
                ref={fileInput}
                className="sr-only"
                type="file"
                accept="image/png,image/jpeg"
                onChange={(event) => selectImage(event.target.files?.[0] ?? null)}
                disabled={imageMutationLocked}
              />
              <div className="flex flex-wrap gap-2">
                {selectedImage ? (
                  <Button type="button" size="sm" disabled={imageMutationLocked} onClick={() => void uploadImage()}>
                    {savingImage ? <Loader2 className="animate-spin" /> : <Upload />}
                    {user.image ? "Replace picture" : "Upload picture"}
                  </Button>
                ) : (
                  <Button type="button" size="sm" variant="outline" disabled={imageMutationLocked} onClick={() => fileInput.current?.click()}>
                    <Upload />Choose picture
                  </Button>
                )}
                {displayedImage ? (
                  <Button type="button" size="sm" variant="outline" disabled={imageMutationLocked} onClick={() => void removeImage()}>
                    <Trash2 />Remove
                  </Button>
                ) : null}
              </div>
            </div>
            {selectedImage ? <p className="text-xs text-muted-foreground">Ready to upload: {selectedImage.name}</p> : null}
            {imageStatus ? <Alert variant={imageStatus.kind === "error" ? "destructive" : "success"} appearance="light"><AlertDescription>{imageStatus.message}</AlertDescription></Alert> : null}
            {pendingImageRefresh !== undefined ? (
              <Button type="button" size="sm" variant="outline" disabled={savingImage} onClick={() => void retryImageRefresh()}>
                {savingImage ? <Loader2 className="animate-spin" /> : <RefreshCw />}Retry account refresh
              </Button>
            ) : null}
          </section>

          <div className="border-t pt-6">
          <form className="space-y-3" onSubmit={saveName} aria-busy={savingName}>
            <div className="space-y-2">
              <Label htmlFor="profile-name">Name</Label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  id="profile-name"
                  value={nameState.draftName}
                  onChange={(event) => {
                    setNameState((current) => ({ ...current, draftName: event.target.value }));
                    setNameStatus(null);
                  }}
                  disabled={savingName}
                  autoComplete="name"
                  className="sm:max-w-md"
                />
                <Button
                  type="submit"
                  size="sm"
                  className="w-full sm:w-auto"
                  disabled={savingName || !nameState.draftName.trim() || nameState.draftName.trim() === nameState.savedName}
                >
                  {savingName && !pendingNameRefresh ? <><Loader2 className="animate-spin" />Saving…</> : "Save name"}
                </Button>
              </div>
            </div>
            {nameStatus ? <Alert variant={nameStatus.kind === "error" ? "destructive" : "success"} appearance="light"><AlertDescription>{nameStatus.message}</AlertDescription></Alert> : null}
            {pendingNameRefresh ? (
              <Button type="button" size="sm" variant="outline" disabled={savingName} onClick={() => void retryNameRefresh()}>
                {savingName ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                Retry account refresh
              </Button>
            ) : null}
          </form>
          </div>

          <div className="border-t pt-6">
            <form className="space-y-4" onSubmit={changeEmail} noValidate aria-busy={sendingVerification}>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Mail className="size-4 text-muted-foreground" aria-hidden="true" />
                  <Label className="font-semibold">Email address</Label>
                </div>
                <Card className="rounded-md bg-muted/40 shadow-none">
                  <CardContent className="px-3 py-2 text-sm text-muted-foreground">{user.email}</CardContent>
                </Card>
                <p className="text-xs text-muted-foreground">Your current address stays active until the new address is verified.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-email">New email</Label>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input
                    id="profile-email"
                    name="newEmail"
                    type="email"
                    required
                    autoComplete="email"
                    value={newEmail}
                    onChange={(event) => {
                      setNewEmail(event.target.value);
                      setEmailDelivery({ kind: "idle" });
                    }}
                    disabled={sendingVerification}
                    className="sm:max-w-md"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    className="w-full sm:w-auto"
                    disabled={sendingVerification || newEmail.trim().toLowerCase() === user.email.toLowerCase()}
                  >
                    {sendingVerification ? <><Loader2 className="animate-spin" />Sending…</> : <><CheckCircle2 />Verify new email</>}
                  </Button>
                </div>
              </div>
              {emailNotice ? <Alert variant={emailNotice.kind === "error" ? "destructive" : "success"} appearance="light"><AlertDescription>{emailNotice.message}</AlertDescription></Alert> : null}
            </form>
          </div>

          <Card className="rounded-sm bg-muted/30 shadow-none">
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <KeyRound className="size-4 text-muted-foreground" aria-hidden="true" />
                  <p className="text-sm font-semibold">Password reset</p>
                </div>
                <p className="text-sm text-muted-foreground">Continue to the secure password-reset flow for your verified email.</p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => window.location.assign(`/forgot-password?email=${encodeURIComponent(user.email)}`)}
              >
                Reset password
              </Button>
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </div>
  );
}
