"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StatusIndicator } from "@/components/indicator";
import { healthIndicatorColor, type ComponentHealth } from "@/lib/status-page";
import { cn } from "@/lib/utils";

const pillTone: Record<ComponentHealth, string> = {
	operational:
		"border-primary/25 bg-primary/10 text-primary hover:bg-primary/15",
	degraded:
		"border-amber-500/25 bg-amber-500/10 text-amber-900 hover:bg-amber-500/15",
	outage: "border-rose-500/25 bg-rose-500/10 text-rose-800 hover:bg-rose-500/15",
	maintenance: "border-sky-500/25 bg-sky-500/10 text-sky-900 hover:bg-sky-500/15",
};

/**
 * Header pill linking to /status. Deliberately NOT live: the Status page's
 * checks are server-side fetches, too heavy to run on every page load for a
 * header pill. It renders as a neutral "operational" link; the page itself
 * shows real health.
 */
export function StatusHeaderPill() {
	const pathname = usePathname();
	const overall: ComponentHealth = "operational";
	const active = pathname === "/status" || pathname.startsWith("/status/");

	return (
		<Button
			render={<Link href="/status" aria-current={active ? "page" : undefined} />}
			variant="outline"
			size="sm"
			className={cn(
				"rounded-full border px-3 font-medium shadow-none",
				pillTone[overall],
				active && "ring-2 ring-ring/40"
			)}
		>
			<StatusIndicator
				className="size-2"
				color={healthIndicatorColor(overall)}
				pulse={overall !== "operational"}
			/>
			Status
		</Button>
	);
}
