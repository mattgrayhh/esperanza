import { cn } from "@/lib/utils";
import type * as React from "react";

function DashboardCard({
	className,
	children,
	showBorders = true,
	...props
}: React.ComponentProps<"div"> & { showBorders?: boolean }) {
	return (
		<div
			className={cn(
				"[--card-padding:1rem]",
				"relative w-full overflow-hidden bg-background p-(--card-padding)",
				className
			)}
			data-slot="card"
			{...props}
		>
			{children}
			{showBorders && <DashboardCardBorders />}
		</div>
	);
}

function DashboardCardBorders({
	className,
	children,
	...props
}: React.ComponentProps<"div">) {
	return (
		<div
			className={cn(
				"absolute inset-[calc(var(--card-padding)-1px)] z-0",
				"*:absolute",
				className
			)}
			data-slot="dashboard-card-borders"
			{...props}
		>
			<div
				className="top-0 left-1/2 h-px w-[200%] -translate-x-1/2 border-t"
				data-slot="dashboard-card-border-t"
			/>
			<div
				className="bottom-0 left-1/2 h-px w-[200%] -translate-x-1/2 border-b"
				data-slot="dashboard-card-border-b"
			/>
			<div
				className="top-1/2 left-0 h-[200%] w-px -translate-y-1/2 border-l"
				data-slot="dashboard-card-border-l"
			/>
			<div
				className="top-1/2 right-0 h-[200%] w-px -translate-y-1/2 border-r"
				data-slot="dashboard-card-border-r"
			/>
		</div>
	);
}

function DashboardCardTitle({
	className,
	...props
}: React.ComponentProps<"span">) {
	return (
		<span
			className={cn(
				"flex items-center gap-1.5 text-muted-foreground text-xs [&_svg]:size-3 [&_svg]:shrink-0",
				className
			)}
			{...props}
		/>
	);
}

function DashboardCardHeader({
	className,
	...props
}: React.ComponentProps<"div">) {
	return (
		<div
			className={cn(
				"relative z-1 flex items-center gap-1 border-b px-(--card-padding) py-3",
				className
			)}
			{...props}
		/>
	);
}

function DashboardCardContent({
	className,
	...props
}: React.ComponentProps<"div">) {
	return (
		<div
			className={cn("relative z-1 size-full p-(--card-padding)", className)}
			{...props}
		/>
	);
}

export {
	DashboardCard,
	DashboardCardContent,
	DashboardCardHeader,
	DashboardCardTitle,
	DashboardCardBorders,
};
