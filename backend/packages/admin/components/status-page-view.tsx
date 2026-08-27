import { CheckIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { StatusIndicator } from "@/components/indicator";
import {
	healthIndicatorColor,
	healthLabel,
	overallBannerCopy,
	type ComponentHealth,
	type StatusComponent,
	type StatusGroup,
	type StatusSnapshot,
} from "@/lib/status-page";
import { cn } from "@/lib/utils";

const bannerTone: Record<ComponentHealth, string> = {
	operational: "bg-primary text-primary-foreground",
	degraded: "bg-amber-500 text-amber-950",
	outage: "bg-rose-600 text-white",
	maintenance: "bg-sky-600 text-white",
};

const badgeTone: Record<ComponentHealth, string> = {
	operational: "border-transparent bg-primary/15 text-primary",
	degraded: "border-transparent bg-amber-500/15 text-amber-900",
	outage: "border-transparent bg-rose-500/15 text-rose-800",
	maintenance: "border-transparent bg-sky-500/15 text-sky-900",
};

function dayBarColor(up: boolean, overall: ComponentHealth): string {
	if (up) return "bg-primary";
	if (overall === "maintenance") return "bg-sky-400";
	return "bg-rose-500";
}

export function StatusOverallBanner({ status }: { status: ComponentHealth }) {
	return (
		<div
			className={cn(
				"flex items-center gap-3 rounded-xl px-4 py-3.5 sm:px-5",
				bannerTone[status]
			)}
			role="status"
		>
			<span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/20">
				{status === "operational" ? (
					<CheckIcon className="size-4" strokeWidth={2.5} />
				) : (
					<StatusIndicator
						className="size-2.5 text-current"
						color={healthIndicatorColor(status)}
						pulse
					/>
				)}
			</span>
			<p className="font-heading text-base font-semibold tracking-tight sm:text-lg">
				{overallBannerCopy(status)}
			</p>
		</div>
	);
}

function UptimeBar({
	component,
	lookbackDays,
}: {
	component: StatusComponent;
	lookbackDays: number;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<div
				className="flex h-8 w-full items-stretch gap-px overflow-hidden rounded-sm"
				role="img"
				aria-label={`${component.uptimePct}% uptime over ${lookbackDays} days`}
			>
				{component.uptimeDays.map((up, i) => (
					<span
						key={i}
						className={cn("min-w-0 flex-1 rounded-[1px]", dayBarColor(up, component.status))}
						title={
							up
								? `Day ${i + 1}: operational`
								: `Day ${i + 1}: incident (placeholder)`
						}
					/>
				))}
			</div>
			<div className="relative flex items-center justify-between border-t border-border/60 pt-1.5 text-[0.7rem] text-muted-foreground">
				<span>{lookbackDays} days ago</span>
				<span className="absolute left-1/2 -translate-x-1/2 underline decoration-border underline-offset-2">
					{component.uptimePct}% uptime
				</span>
				<span>today</span>
			</div>
		</div>
	);
}

function ComponentRow({
	component,
	lookbackDays,
}: {
	component: StatusComponent;
	lookbackDays: number;
}) {
	return (
		<div className="flex flex-col gap-3 border-b border-border/70 py-4 last:border-b-0">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="font-medium text-foreground">{component.name}</p>
					{component.description ? (
						<p className="mt-0.5 text-xs text-muted-foreground">{component.description}</p>
					) : null}
				</div>
				<Badge className={cn("shrink-0", badgeTone[component.status])}>
					{healthLabel(component.status)}
				</Badge>
			</div>
			{component.detail ? (
				<p className="text-xs text-muted-foreground">{component.detail}</p>
			) : null}
			{component.uptimeDays.length > 0 ? (
				<UptimeBar component={component} lookbackDays={lookbackDays} />
			) : null}
		</div>
	);
}

export function StatusGroupSection({
	group,
	lookbackDays,
}: {
	group: StatusGroup;
	lookbackDays: number;
}) {
	return (
		<section className="rounded-xl bg-card ring-1 ring-foreground/10">
			<header className="border-b border-border/70 px-4 py-3 sm:px-5">
				<h2 className="font-heading text-sm font-semibold text-foreground">{group.name}</h2>
				{group.description ? (
					<p className="mt-0.5 text-xs text-muted-foreground">{group.description}</p>
				) : null}
			</header>
			<div className="px-4 sm:px-5">
				{group.components.map((c) => (
					<ComponentRow key={c.id} component={c} lookbackDays={lookbackDays} />
				))}
			</div>
		</section>
	);
}

export function StatusPageView({
	snapshot,
	children,
}: {
	snapshot: StatusSnapshot;
	children?: React.ReactNode;
}) {
	const updated = new Date(snapshot.updatedAt);

	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
			<header className="flex flex-col gap-1">
				<h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
					Status
				</h1>
				<p className="text-sm text-muted-foreground">
					Infrastructure and site-service health. Updated{" "}
					<time dateTime={snapshot.updatedAt}>
						{updated.toLocaleString(undefined, {
							dateStyle: "medium",
							timeStyle: "short",
						})}
					</time>
					.
				</p>
			</header>

			<StatusOverallBanner status={snapshot.overall} />

			{snapshot.sourceNote || snapshot.websitePingNote ? (
				<p className="rounded-lg border border-dashed border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
					{snapshot.sourceNote} {snapshot.websitePingNote}
				</p>
			) : null}

			<div className="flex flex-col gap-4">
				{snapshot.groups.map((group) => (
					<StatusGroupSection
						key={group.id}
						group={group}
						lookbackDays={snapshot.lookbackDays}
					/>
				))}
				{children}
			</div>
		</div>
	);
}
