import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatusIndicator } from "@/components/indicator";
import {
	DashboardCard,
	DashboardCardContent,
	DashboardCardHeader,
	DashboardCardTitle,
} from "@/components/dashboard-card";
import { EllipsisVerticalIcon, ServerIcon, ArrowRightIcon, GitBranchIcon } from "lucide-react";

type DeploymentRow = {
	version: string;
	branch: string;
	environment: "production" | "staging" | "development";
	commit_message: string;
	date: string;
	status: "healthy" | "stable" | "warning";
	cached: boolean;
};

const deploymentRows: DeploymentRow[] = [
	{
		version: "2.8.1",
		branch: "main",
		environment: "production",
		commit_message: "Improve edge cache invalidation strategy",
		date: "May 19",
		status: "healthy",
		cached: true,
	},
	{
		version: "2.8.0",
		branch: "release/2.8",
		environment: "production",
		commit_message: "Patch payment webhook retry logic",
		date: "May 18",
		status: "stable",
		cached: true,
	},
	{
		version: "2.9.0-rc.1",
		branch: "release/2.9",
		environment: "staging",
		commit_message: "Add budget dashboard summary cards",
		date: "May 18",
		status: "warning",
		cached: false,
	},
	{
		version: "2.7.6",
		branch: "hotfix/auth-session",
		environment: "production",
		commit_message: "Fix stale session token refresh race",
		date: "May 17",
		status: "healthy",
		cached: true,
	},
	{
		version: "2.9.0-beta.3",
		branch: "feature/usage-breakdown",
		environment: "staging",
		commit_message: "Refine monthly budget usage graph labels",
		date: "May 17",
		status: "stable",
		cached: false,
	},
	{
		version: "2.6.9",
		branch: "main",
		environment: "production",
		commit_message: "Update observability tags for API gateway",
		date: "May 16",
		status: "healthy",
		cached: true,
	},
	{
		version: "3.0.0-alpha.2",
		branch: "next/core-rewrite",
		environment: "development",
		commit_message: "Enable route-level response compression",
		date: "May 16",
		status: "warning",
		cached: false,
	},
	{
		version: "2.8.2",
		branch: "hotfix/cache-headers",
		environment: "production",
		commit_message: "Correct CDN cache-control header mismatch",
		date: "May 15",
		status: "stable",
		cached: true,
	},
	{
		version: "2.9.0-beta.4",
		branch: "feature/metrics-panel",
		environment: "staging",
		commit_message: "Add p95 request duration KPI tile",
		date: "May 15",
		status: "healthy",
		cached: false,
	},
	{
		version: "3.0.0-alpha.3",
		branch: "next/runtime-v2",
		environment: "development",
		commit_message: "Prototype runtime sandbox isolation",
		date: "May 14",
		status: "stable",
		cached: false,
	},
];

function statusColor(status: (typeof deploymentRows)[number]["status"]) {
	if (status === "healthy") {
		return "emerald";
	}
	if (status === "warning") {
		return "amber";
	}
	return "sky";
}

function formatEnvironment(environment: DeploymentRow["environment"]) {
	return environment.charAt(0).toUpperCase() + environment.slice(1);
}

function DeploymentRowActions() {
	return (
		<Button aria-label="deployment actions" size="icon-sm" variant="ghost">
			<EllipsisVerticalIcon
			/>
		</Button>
	);
}

export function ActiveDeployments() {
	return (
		<DashboardCard>
			<DashboardCardHeader className="justify-between">
				<DashboardCardTitle className="text-foreground text-sm">
					<ServerIcon
					/>
					Active deployments
				</DashboardCardTitle>
				<Button
					className="text-muted-foreground"
					size="xs"
					type="button"
					variant="ghost"
				>
					View all
					<ArrowRightIcon aria-hidden="true" data-icon="inline-end" />
				</Button>
			</DashboardCardHeader>
			<DashboardCardContent className="divide-y p-0">
				{deploymentRows.map((row) => (
					<DeploymentRowItem
						key={`${row.version}-${row.branch}-${row.date}`}
						row={row}
					/>
				))}
			</DashboardCardContent>
		</DashboardCard>
	);
}

function DeploymentRowItem({
	row,
	...props
}: React.ComponentProps<"div"> & { row: DeploymentRow }) {
	return (
		<div {...props}>
			<div className="flex flex-col gap-3 p-4 text-sm md:hidden">
				<div className="flex items-start justify-between gap-3">
					<div className="flex min-w-0 flex-col">
						<span className="text-foreground">v{row.version}</span>
						<span className="font-light text-muted-foreground text-xs">
							{formatEnvironment(row.environment)}
						</span>
					</div>
					<DeploymentRowActions />
				</div>
				<div className="flex min-w-0 flex-col">
					<div className="flex min-w-0 items-center gap-1.5">
						<GitBranchIcon className="size-4 shrink-0 text-muted-foreground" />
						<span className="truncate text-sm">{row.branch}</span>
					</div>
					<span className="truncate text-muted-foreground text-xs">
						{row.commit_message}
					</span>
				</div>
				<div className="flex flex-wrap items-center gap-x-4 gap-y-1">
					<div className="flex items-center gap-1">
						<StatusIndicator
							className="size-2.5"
							color={statusColor(row.status)}
							pulse={false}
						/>
						<span className="text-foreground text-xs capitalize">
							{row.status}
						</span>
					</div>
					<span className="text-muted-foreground tabular-nums">{row.date}</span>
					<div className="flex items-center gap-1">
						<StatusIndicator
							className="size-2.5"
							color={row.cached ? "emerald" : "amber"}
							pulse={false}
						/>
						<span className="text-foreground text-xs">
							{row.cached ? "Cached" : "Cold"}
						</span>
					</div>
				</div>
			</div>
			<div
				className={cn(
					"hidden items-center gap-4 p-4 text-sm md:grid md:px-6",
					"md:grid-cols-[minmax(0,0.2fr)_minmax(0,0.2fr)_minmax(0,1fr)_minmax(0,0.15fr)_minmax(0,0.15fr)_auto]"
				)}
			>
				<div className="flex min-w-0 flex-col">
					<span className="text-foreground">v{row.version}</span>
					<span className="font-light text-muted-foreground text-xs">
						{formatEnvironment(row.environment)}
					</span>
				</div>
				<div className="flex items-center gap-1">
					<StatusIndicator
						className="size-2.5"
						color={statusColor(row.status)}
						pulse={false}
					/>
					<span className="text-foreground text-xs capitalize">
						{row.status}
					</span>
				</div>
				<div className="flex min-w-0 flex-col">
					<div className="flex min-w-0 items-center gap-1.5">
						<GitBranchIcon className="size-4 shrink-0 text-muted-foreground" />
						<span className="truncate text-sm">{row.branch}</span>
					</div>
					<span className="truncate text-muted-foreground text-xs">
						{row.commit_message}
					</span>
				</div>
				<div className="flex items-center">
					<span className="text-muted-foreground tabular-nums">{row.date}</span>
				</div>
				<div className="flex items-center gap-1">
					<StatusIndicator
						className="size-2.5"
						color={row.cached ? "emerald" : "amber"}
						pulse={false}
					/>
					<span className="text-foreground text-xs">
						{row.cached ? "Cached" : "Cold"}
					</span>
				</div>
				<div className="flex items-center justify-end">
					<DeploymentRowActions />
				</div>
			</div>
		</div>
	);
}
