"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { DashboardCard, DashboardCardContent } from "@/components/dashboard-card";
import { TimeOfDayIcon } from "@/components/time-of-day-icon";
import { MoreHorizontalIcon } from "lucide-react";

type PeriodHours = 1 | 4 | 12 | 24;

const PERIOD_OPTIONS: { value: PeriodHours; label: string }[] = [
	{ value: 1, label: "Last 1 hour" },
	{ value: 4, label: "Last 4 hours" },
	{ value: 12, label: "Last 12 hours" },
	{ value: 24, label: "Last 24 hours" },
];

function TimeRangeSegment() {
	const [hours, setHours] = useState<PeriodHours>(4);

	return (
		<Select
			onValueChange={(v) => setHours(Number(v) as PeriodHours)}
			value={String(hours)}
		>
			<SelectTrigger
				aria-label="Stats time range preset"
				className="border-border bg-transparent"
			>
				<SelectValue />
			</SelectTrigger>
			<SelectContent align="start">
				{PERIOD_OPTIONS.map((o) => (
					<SelectItem key={o.value} value={String(o.value)}>
						{o.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

export function StatsToolbar() {
	return (
		<DashboardCard>
			<DashboardCardContent className="flex items-start justify-between md:items-center">
				<div className="flex flex-col">
					<TimeOfDayIcon className="mask-b-from-0% size-7 text-current" />
					<h2 className="-mt-1 text-balance font-medium text-xl">
						Welcome back
					</h2>
				</div>
				<div className="flex flex-wrap items-center justify-end gap-2 sm:w-auto">
					<TimeRangeSegment />
					<Button
						aria-label="More options"
						className="bg-transparent"
						size="icon"
						variant="outline"
					>
						<MoreHorizontalIcon
						/>
					</Button>
				</div>
			</DashboardCardContent>
		</DashboardCard>
	);
}
