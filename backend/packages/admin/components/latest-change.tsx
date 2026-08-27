"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import * as React from "react";

export type LatestChangeData = {
	href: string;
	title: string;
	description: string;
	image: string;
};

const data: LatestChangeData = {
	href: "#/deployments",
	title: "Edge deployments are here",
	description:
		"Deploy to 30+ regions with automatic failover and zero-config routing",
	image: "https://storage.efferd.com/creative/color-bends.webp",
};

export function LatestChange() {
	const [dismissed, setDismissed] = React.useState(false);

	if (dismissed) {
		return null;
	}
	return (
		<div className="relative w-full">
			<div className="group/news relative gap-2 overflow-hidden border-t p-4 text-xs">
				<div className="flex flex-col gap-1">
					<span className="line-clamp-1 font-medium text-foreground">
						{data.title}
					</span>
					<p className="line-clamp-2 h-10 text-muted-foreground leading-5">
						{data.description}
					</p>
				</div>
				<div className="relative mt-3 aspect-video w-full shrink-0 overflow-hidden rounded border bg-muted">
					<img
						alt={data.title}
						className={cn("size-full rounded object-cover object-center")}
						draggable={false}
						height={180}
						src={data.image}
						width={320}
					/>
				</div>
				<div
					className={cn(
						"h-0 overflow-hidden opacity-0 transition-[height,opacity] duration-200",
						"sm:group-hover/news:h-7 sm:group-hover/news:opacity-100"
					)}
				>
					<div className="flex items-center justify-between pt-3 text-xs">
						<Link
							className="font-medium text-muted-foreground transition-colors duration-75 hover:text-foreground"
							href={data.href}
							target="_blank"
						>
							Read more
						</Link>
						<button
							className="text-muted-foreground transition-colors duration-75 hover:text-foreground"
							onClick={() => setDismissed(true)}
							type="button"
						>
							Dismiss
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
