"use client";

import { cn } from "@/lib/utils";
import { useId } from "react";
import { Area, AreaChart } from "recharts";
import { type ChartConfig, ChartContainer } from "@/components/ui/chart";

type SparklineAreaChartProps = {
	color: string;
	id?: string;
	label: string;
	className?: string;
	series: readonly number[];
};

type MetricChartPoint = {
	index: number;
	metric: number;
};

export function SparklineAreaChart({
	color,
	id,
	label,
	className,
	series,
}: SparklineAreaChartProps) {
	const autoId = useId();

	const chartData: MetricChartPoint[] = series.map((metric, index) => ({
		index,
		metric,
	}));

	const chartConfig = {
		metric: {
			label,
			color,
		},
	} satisfies ChartConfig;

	const gradientSuffix = (id ?? autoId).replace(/[^a-zA-Z0-9_-]/g, "");
	const gradientId = `metric-area-${gradientSuffix}`;

	return (
		<ChartContainer
			className={cn("aspect-auto h-10 w-full", className)}
			config={chartConfig}
		>
			<AreaChart
				accessibilityLayer
				data={chartData}
				margin={{ left: 0, right: 0, top: 0, bottom: 0 }}
			>
				<defs>
					<linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
						<stop
							offset="0%"
							stopColor="var(--color-metric)"
							stopOpacity={0.4}
						/>
						<stop
							offset="100%"
							stopColor="var(--color-metric)"
							stopOpacity={0}
						/>
					</linearGradient>
				</defs>
				<Area
					dataKey="metric"
					dot={false}
					fill={`url(#${gradientId})`}
					isAnimationActive={false}
					stroke="var(--color-metric)"
					strokeWidth={1}
					type="linear"
				/>
			</AreaChart>
		</ChartContainer>
	);
}
