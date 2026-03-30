"use client";

import { createContext, useContext } from "react";

type UserRole = "admin" | "editor" | "viewer";

const RoleContext = createContext<UserRole>("viewer");

export function RoleProvider({
  role,
  children
}: {
  role: string;
  children: React.ReactNode;
}) {
  return (
    <RoleContext.Provider value={(role as UserRole) || "viewer"}>
      {children}
    </RoleContext.Provider>
  );
}

export function useUserRole(): UserRole {
  return useContext(RoleContext);
}

export function useCanEdit(): boolean {
  const role = useUserRole();
  return role === "admin" || role === "editor";
}
