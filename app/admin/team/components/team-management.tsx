"use client";

import { useCallback, useEffect, useState } from "react";
import { MoreHorizontal, Plus, Shield, ShieldCheck, Eye, Trash2 } from "lucide-react";

import { authClient } from "@/lib/auth/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";

type User = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  role?: string | null;
  createdAt: Date;
};

const ROLES = [
  { value: "admin", label: "Admin", description: "Full access + team management", icon: ShieldCheck },
  { value: "editor", label: "Editor", description: "Can create and edit data", icon: Shield },
  { value: "viewer", label: "Viewer", description: "Read-only access", icon: Eye }
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
  const [loading, setLoading] = useState(true);

  // Create user form
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("viewer");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  // Remove dialog
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

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError("");
    setCreating(true);
    try {
      const res = await authClient.admin.createUser({
        name: name.trim(),
        email: email.trim(),
        password,
        role: role as "admin"
      });
      if (res.error) {
        setCreateError(res.error.message ?? "Failed to create user");
        return;
      }
      setName("");
      setEmail("");
      setPassword("");
      setRole("viewer");
      await fetchUsers();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setCreating(false);
    }
  };

  const handleSetRole = async (userId: string, newRole: string) => {
    await authClient.admin.setRole({
      userId,
      role: newRole as "admin"
    });
    await fetchUsers();
  };

  const handleRemoveUser = async () => {
    if (!removeDialog.user) return;
    setRemoving(true);
    try {
      await authClient.admin.removeUser({
        userId: removeDialog.user.id
      });
      setRemoveDialog({ open: false, user: null });
      await fetchUsers();
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      {/* Create User */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="size-5" />
            Add Team Member
          </CardTitle>
          <CardDescription>
            Create a new user account. They can log in with the email and password you set.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreateUser} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  placeholder="John Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="john@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Min 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <div className="flex gap-1">
                  {ROLES.map((r) => (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => setRole(r.value)}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-xs font-medium transition-colors ${
                        role === r.value
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      }`}
                    >
                      <r.icon className="size-3.5" />
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {createError && (
              <p className="text-sm text-destructive">{createError}</p>
            )}
            <div>
              <Button type="submit" disabled={creating}>
                {creating ? "Creating..." : "Create User"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* User List */}
      <Card>
        <CardHeader>
          <CardTitle>Team Members</CardTitle>
          <CardDescription>
            {loading ? "Loading..." : `${users.length} member${users.length !== 1 ? "s" : ""}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => {
                const isCurrentUser = u.email === currentUserEmail;
                return (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          {u.image && <AvatarImage src={u.image} alt={u.name} />}
                          <AvatarFallback className="text-xs">
                            {getInitials(u.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">
                            {u.name}
                            {isCurrentUser && (
                              <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>
                            )}
                          </span>
                          <span className="text-xs text-muted-foreground">{u.email}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={roleBadgeVariant(u.role)}>
                        {u.role ?? "viewer"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {u.createdAt.toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      {!isCurrentUser && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="size-8 p-0">
                              <MoreHorizontal className="size-4" />
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
                                {u.role === r.value && (
                                  <span className="ml-auto text-xs text-muted-foreground">
                                    current
                                  </span>
                                )}
                              </DropdownMenuItem>
                            ))}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onSelect={() => setRemoveDialog({ open: true, user: u })}
                            >
                              <Trash2 className="mr-2 size-4" />
                              Remove user
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {!loading && users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    No team members yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Remove Confirmation Dialog */}
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
              <strong>{removeDialog.user?.name}</strong> ({removeDialog.user?.email})? This
              action cannot be undone. They will lose access immediately.
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
