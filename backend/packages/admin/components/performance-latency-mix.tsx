import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
	DashboardCard,
	DashboardCardContent,
	DashboardCardTitle,
} from "@/components/dashboard-card";
import { TimerIcon } from "lucide-react";

const P95_MS = 23.7;

const SEGMENTS = [
	{ pct: 45, label: "P50", color: "var(--chart-1)" },
	{ pct: 35, label: "P95", color: "var(--chart-3)" },
	{ pct: 20, label: "P99", color: "var(--chart-5)" },
] as const;

export function PerformanceLatencyMix() {
	return (
		<DashboardCard>
			<DashboardCardContent className="flex flex-col gap-6">
				<div className="flex items-start justify-between">
					<div className="flex min-w-0 flex-col gap-1">
						<DashboardCardTitle>Latency distribution</DashboardCardTitle>
						<span className="text-balance font-semibold text-2xl tabular-nums">
							{P95_MS} ms
							<span className="font-normal text-muted-foreground text-sm">
								{" "}
								p95
							</span>
						</span>
					</div>
					<Button className="text-muted-foreground" size="sm" variant="ghost">
						<TimerIcon aria-hidden="true" data-icon="inline-start" />
						Open metrics
					</Button>
				</div>

				<div className="flex gap-1">
					{SEGMENTS.map((s) => (
						<div
							className="flex min-w-0 flex-col gap-1"
							key={s.label}
							style={{ flex: `${s.pct} 1 0%` }}
						>
							<div className="flex flex-col gap-1">
								<span className="text-muted-foreground text-xs tabular-nums">
									{s.pct}%
								</span>
								<div
									aria-hidden="true"
									className="h-4 w-px shrink-0 bg-muted-foreground/35"
								/>
							</div>
							<div
								className={cn("rounded-lg h-4 w-full min-w-0")}
								style={{ backgroundColor: s.color }}
							/>
						</div>
					))}
				</div>

				<div className="flex flex-wrap gap-x-6 gap-y-2">
					{SEGMENTS.map((s) => (
						<div className="flex items-center gap-2" key={s.label}>
							<span
								aria-hidden="true"
								className={cn("size-2 shrink-0 rounded-full")}
								style={{ backgroundColor: s.color }}
							/>
							<span className="text-muted-foreground text-xs">{s.label}</span>
						</div>
					))}
				</div>
			</DashboardCardContent>
		</DashboardCard>
	);
}
