"use client";

import { Button } from "@/components/ui/button";
import { Delta, DeltaIcon, DeltaValue } from "@/components/delta";
import {
	DashboardCard,
	DashboardCardContent,
	DashboardCardTitle,
} from "@/components/dashboard-card";
import { SparklineAreaChart } from "@/components/sparkline-area-chart";
import { TimerIcon, InfoIcon } from "lucide-react";

const executionDurationSeries = [
	0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0,
	0, 1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 1, 0, 0, 0, 4, 0, 0, 0, 2, 0, 0, 0,
] as const;

const executionDurationColor = "var(--chart-2)";

export function ExecutionDurationCard() {
	return (
		<DashboardCard className="flex flex-col gap-4">
			<DashboardCardContent className="flex flex-col gap-2.5 pt-2 pb-0">
				<div className="flex items-center justify-between gap-2">
					<DashboardCardTitle className="text-[10px]">
						<TimerIcon aria-hidden="true" />{" "}
						Execution Duration
					</DashboardCardTitle>
					<Button
						aria-label="More options"
						className="text-muted-foreground"
						size="icon-xs"
						variant="ghost"
					>
						<InfoIcon
						/>
					</Button>
				</div>
				<div className="flex items-end justify-between gap-2.5">
					<span className="text-xl tabular-nums leading-none tracking-wide">
						2.4 GB-sec
					</span>
					<Delta
						className="shrink-0 text-[11px]"
						style={{ color: executionDurationColor }}
						value={1.19}
					>
						<DeltaIcon variant="arrow" />
						<DeltaValue precision={2} />
					</Delta>
				</div>
			</DashboardCardContent>
			<div className="mt-auto w-full">
				<SparklineAreaChart
					className="h-20 w-full"
					color={executionDurationColor}
					id="execution-duration"
					label="Execution Duration"
					series={executionDurationSeries}
				/>
			</div>
		</DashboardCard>
	);
}
