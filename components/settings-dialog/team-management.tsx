"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Eye,
  Mail,
  MoreHorizontal,
  Shield,
  ShieldCheck,
  Trash2,
  X
} from "lucide-react";

import { authClient } from "@/lib/auth/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

type User = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  role?: string | null;
  createdAt: Date;
};

type Invitation = {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  createdAt: string;
};

const ROLES = [
  { value: "admin", label: "Admin", icon: ShieldCheck },
  { value: "editor", label: "Editor", icon: Shield },
  { value: "viewer", label: "Viewer", icon: Eye }
] as const;

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function roleBadgeVariant(role: string | null | undefined): "default" | "secondary" | "outline" {
  switch (role) {
    case "admin":
      return "default";
    case "editor":
      return "secondary";
    default:
      return "outline";
  }
}

export function TeamManagement({ currentUserEmail }: { currentUserEmail: string }) {
  const [users, setUsers] = useState<User[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("viewer");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");

  const [removeDialog, setRemoveDialog] = useState<{
    open: boolean;
    user: User | null;
  }>({ open: false, user: null });
  const [removing, setRemoving] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await authClient.admin.listUsers({
        query: { limit: 100 }
      });
      if (res.data) {
        type RawUser = {
          id: string;
          name: string;
          email: string;
          image?: string | null;
          role?: string | null;
          createdAt: Date | string;
        };
        setUsers(
          (res.data.users as RawUser[]).map((u) => ({
            id: u.id,
            name: u.name,
            email: u.email,
            image: u.image ?? null,
            role: u.role ?? null,
            createdAt: new Date(u.createdAt as unknown as string)
          }))
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchInvitations = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/invitations");
      if (res.ok) {
        const data = await res.json();
        setInvitations(
          (data.invitations as Invitation[]).filter((i) => i.status === "pending")
        );
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchUsers();
    fetchInvitations();
  }, [fetchUsers, fetchInvitations]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError("");
    setInviteSuccess("");
    setInviting(true);
    try {
      const res = await fetch("/api/admin/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole })
      });
      const data = await res.json();
      if (!res.ok) {
        setInviteError(data.error ?? "Failed to send invitation");
        return;
      }
      const emailNote = data.emailSent
        ? "Invitation email sent!"
        : data.hasEmailService
          ? "Invitation created but email failed to send."
          : "Invitation created. (No email service configured)";
      setInviteSuccess(emailNote);
      setInviteEmail("");
      setInviteRole("viewer");
      await fetchInvitations();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Failed to send invitation");
    } finally {
      setInviting(false);
      setTimeout(() => setInviteSuccess(""), 5000);
    }
  };

  const handleRevokeInvite = async (id: string) => {
    await fetch(`/api/admin/invitations?id=${id}`, { method: "DELETE" });
    await fetchInvitations();
  };

  const handleSetRole = async (userId: string, newRole: string) => {
    await authClient.admin.setRole({ userId, role: newRole as "admin" });
    await fetchUsers();
  };

  const handleRemoveUser = async () => {
    if (!removeDialog.user) return;
    setRemoving(true);
    try {
      await authClient.admin.removeUser({ userId: removeDialog.user.id });
      setRemoveDialog({ open: false, user: null });
      await fetchUsers();
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="flex flex-col">
      {/* Invite Section */}
      <div className="px-6 py-5">
        <p className="mb-3 text-sm text-muted-foreground">
          Invite a team member by email. They&apos;ll set their own password when they accept.
        </p>
        <form onSubmit={handleInvite} className="flex items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="invite-email" className="text-xs">Email</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="colleague@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              required
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Role</Label>
            <div className="flex gap-0.5">
              {ROLES.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setInviteRole(r.value)}
                  className={`flex items-center gap-1 rounded-md border px-2.5 py-2 text-xs font-medium transition-colors ${
                    inviteRole === r.value
                      ? "border-border bg-accent text-accent-foreground shadow-sm"
                      : "border-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  }`}
                >
                  <r.icon className="size-3" />
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <Button type="submit" size="sm" disabled={inviting} className="h-9">
            <Mail className="mr-1.5 size-3.5" />
            {inviting ? "Sending..." : "Invite"}
          </Button>
        </form>
        {inviteError && <p className="mt-2 text-xs text-destructive">{inviteError}</p>}
        {inviteSuccess && <p className="mt-2 text-xs text-emerald-500">{inviteSuccess}</p>}
      </div>

      {/* Pending Invitations */}
      {invitations.length > 0 && (
        <>
          <Separator />
          <div className="px-6 py-4">
            <h4 className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Pending Invitations
            </h4>
            <div className="flex flex-col gap-1.5">
              {invitations.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{inv.email}</span>
                    <Badge variant={roleBadgeVariant(inv.role)} className="text-[10px]">
                      {inv.role}
                    </Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="size-7 p-0"
                    onClick={() => handleRevokeInvite(inv.id)}
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Members List */}
      <Separator />
      <div className="px-6 py-4">
        <h4 className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {loading ? "Loading..." : `${users.length} Member${users.length !== 1 ? "s" : ""}`}
        </h4>
        <div className="flex flex-col gap-1">
          {users.map((u) => {
            const isCurrentUser = u.email === currentUserEmail;
            return (
              <div
                key={u.id}
                className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50"
              >
                <Avatar className="h-8 w-8">
                  {u.image && <AvatarImage src={u.image} alt={u.name} />}
                  <AvatarFallback className="text-xs">{getInitials(u.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{u.name}</span>
                    {isCurrentUser && (
                      <span className="text-[10px] text-muted-foreground">(you)</span>
                    )}
                  </div>
                  <span className="truncate text-xs text-muted-foreground">{u.email}</span>
                </div>
                <Badge variant={roleBadgeVariant(u.role)} className="text-[10px]">
                  {u.role ?? "viewer"}
                </Badge>
                {!isCurrentUser && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="size-7 p-0">
                        <MoreHorizontal className="size-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {ROLES.map((r) => (
                        <DropdownMenuItem
                          key={r.value}
                          disabled={u.role === r.value}
                          onSelect={() => handleSetRole(u.id, r.value)}
                        >
                          <r.icon className="mr-2 size-4" />
                          Set as {r.label}
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={() => setRemoveDialog({ open: true, user: u })}
                      >
                        <Trash2 className="mr-2 size-4" />
                        Remove
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Remove Confirmation */}
      <Dialog
        open={removeDialog.open}
        onOpenChange={(open) => {
          if (!open) setRemoveDialog({ open: false, user: null });
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove team member</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove{" "}
              <strong>{removeDialog.user?.name}</strong> ({removeDialog.user?.email})?
              They will lose access immediately.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setRemoveDialog({ open: false, user: null })}
              disabled={removing}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleRemoveUser} disabled={removing}>
              {removing ? "Removing..." : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
