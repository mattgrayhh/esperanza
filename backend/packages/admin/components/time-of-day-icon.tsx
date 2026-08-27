"use client";

import type { ComponentProps } from "react";
import { MoonIcon, SunIcon } from "lucide-react";

export type TimeOfDayPeriod = "day" | "night";

/** Local day/night buckets for toolbar sun/moon icons. */
export function getTimeOfDayPeriod(now = new Date()): TimeOfDayPeriod {
	const hour = now.getHours();
	if (hour < 5 || hour >= 21) {
		return "night";
	}
	return "day";
}

const PERIOD_LABEL: Record<TimeOfDayPeriod, string> = {
	day: "Day",
	night: "Night",
};

export function TimeOfDayIcon({ ...props }: ComponentProps<"svg">) {
	const period = getTimeOfDayPeriod();

	const icon =
		period === "night" ? (
			<MoonIcon aria-hidden {...props} />
		) : (
			<SunIcon aria-hidden {...props} />
		);

	return (
		<span aria-label={PERIOD_LABEL[period]} role="img" suppressHydrationWarning>
			{icon}
		</span>
	);
}
