"use client";

import { ActiveDeployments } from "@/components/active-deployments";
import { AiInsight } from "@/components/ai-insight";
import { ExecutionDurationCard } from "@/components/execution-duration-card";
import { PerformanceLatencyMix } from "@/components/performance-latency-mix";
import { RequestDurationCard } from "@/components/request-duration-card";
import { DashboardStats } from "@/components/stats";
import { StatsToolbar } from "@/components/stats-toolbar";

export function Dashboard() {
	return (
		<div className="flex flex-col gap-px bg-border">
			<StatsToolbar />
			<DashboardStats />
			<div className="grid grid-cols-1 gap-px lg:grid-cols-2">
				<ExecutionDurationCard />
				<RequestDurationCard />
				<AiInsight />
				<PerformanceLatencyMix />
			</div>
			<ActiveDeployments />
			<div className="h-12 bg-background" />
		</div>
	);
}
