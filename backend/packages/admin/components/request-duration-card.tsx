"use client";

import { Button } from "@/components/ui/button";
import { Delta, DeltaIcon, DeltaValue } from "@/components/delta";
import {
	DashboardCard,
	DashboardCardContent,
	DashboardCardTitle,
} from "@/components/dashboard-card";
import { SparklineAreaChart } from "@/components/sparkline-area-chart";
import { GlobeIcon, InfoIcon } from "lucide-react";

const requestDurationSeries = [
	0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 3, 0,
	0, 0, 2, 0, 0, 0, 4, 0, 0, 0, 3, 0, 0, 0, 5, 0, 0, 0, 2, 0, 0, 0, 6, 0, 0,
] as const;

const requestDurationColor = "var(--chart-2)";

export function RequestDurationCard() {
	return (
		<DashboardCard className="flex flex-col gap-4">
			<DashboardCardContent className="flex flex-col gap-2.5 pt-2 pb-0">
				<div className="flex items-center justify-between gap-2">
					<DashboardCardTitle className="text-[10px]">
						<GlobeIcon aria-hidden="true" />{" "}
						Request Duration
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
						23.7 ms
					</span>
					<Delta
						className="shrink-0 text-[11px]"
						style={{ color: requestDurationColor }}
						value={30.3}
					>
						<DeltaIcon variant="arrow" />
						<DeltaValue precision={2} />
					</Delta>
				</div>
			</DashboardCardContent>
			<div className="mt-auto w-full">
				<SparklineAreaChart
					className="h-20 w-full"
					color={requestDurationColor}
					id="request-duration"
					label="Request Duration"
					series={requestDurationSeries}
				/>
			</div>
		</DashboardCard>
	);
}
