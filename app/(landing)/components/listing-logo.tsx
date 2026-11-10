"use client";

import { Euro } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/ui/utils";

const names = { apple: "Apple", nvidia: "NVIDIA", bitcoin: "Bitcoin", euro: "Euro" };

export function ListingLogo({
  name,
  className,
}: {
  name: keyof typeof names;
  className?: string;
}) {
  return (
    <Avatar className={cn("size-10 rounded-lg border border-border bg-white p-2", className)}>
      {name !== "euro" && (
        <AvatarImage
          src={`/listing-logos/${name}.svg`}
          alt={`${names[name]} logo`}
          className="object-contain"
        />
      )}
      <AvatarFallback className="rounded-none bg-white text-neutral-900">
        {name === "euro" ? <Euro aria-label="Euro" className="size-5" /> : names[name].slice(0, 1)}
      </AvatarFallback>
    </Avatar>
  );
}
