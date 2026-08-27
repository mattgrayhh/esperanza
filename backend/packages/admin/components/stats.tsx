"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Delta, DeltaIcon, DeltaValue } from "@/components/delta";
import {
	DashboardCard,
	DashboardCardBorders,
	DashboardCardContent,
	DashboardCardTitle,
} from "@/components/dashboard-card";
import { SparklineAreaChart } from "@/components/sparkline-area-chart";
import { BarChart3Icon, TriangleAlertIcon, CpuIcon, CalendarIcon, InfoIcon } from "lucide-react";

type Stat = {
	label: string;
	value: string;
	delta: number;
	color: string;
	series: readonly number[];
	icon: ReactNode;
};

const stats: readonly Stat[] = [
	{
		label: "Requests",
		value: "2.8M",
		delta: 8.2,
		color: "var(--chart-2)",
		series: [
			0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
			0, 0, 0, 1, 0, 0, 0, 3, 0, 0, 0, 2, 0, 0, 0, 4, 0, 0, 0, 3, 2, 5, 0, 0, 0,
		],
		icon: (
			<BarChart3Icon aria-hidden="true" />
		),
	},
	{
		label: "Errors",
		value: "0.28%",
		delta: 4.1,
		color: "var(--chart-2)",
		series: [
			0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
			0, 0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
		],
		icon: (
			<TriangleAlertIcon aria-hidden="true" />
		),
	},
	{
		label: "CPU Time",
		value: "23.7 ms",
		delta: -1.3,
		color: "var(--chart-2)",
		series: [
			0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0,
			0, 0, 0, 0, 0, 2, 0, 0, 0, 5, 4, 3, 6, 0, 4, 0, 0, 0, 0, 0, 8, 0, 0, 0, 0,
		],
		icon: (
			<CpuIcon aria-hidden="true" />
		),
	},
	{
		label: "Wall Time",
		value: "0.05 ms",
		delta: 6.8,
		color: "var(--chart-2)",
		series: [
			0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
			0, 0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0,
		],
		icon: (
			<CalendarIcon aria-hidden="true" />
		),
	},
];

export function DashboardStats() {
	return (
		<div className="grid grid-cols-1 gap-px md:grid-cols-2 lg:grid-cols-4">
			{stats.map((s) => (
				<DashboardCard
					className="flex flex-col gap-4 pb-0"
					key={s.label}
					showBorders={false}
				>
					<DashboardCardContent className="flex flex-col gap-2.5 pt-2 pb-0">
						<div className="flex items-center justify-between gap-2">
							<DashboardCardTitle className="text-[10px]">
								{s.icon} {s.label}
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
								{s.value}
							</span>
							<Delta
								className="shrink-0 text-[11px]"
								style={{ color: s.color }}
								value={s.delta}
							>
								<DeltaIcon variant="arrow" />
								<DeltaValue precision={2} />
							</Delta>
						</div>
					</DashboardCardContent>
					<div className="mt-auto w-full">
						<SparklineAreaChart
							color={s.color}
							id={s.label}
							label={s.label}
							series={s.series}
						/>
					</div>

					<DashboardCardBorders className="*:data-[slot=dashboard-card-border-b]:hidden" />
				</DashboardCard>
			))}
		</div>
	);
}
