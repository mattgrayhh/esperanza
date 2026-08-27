import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DashboardCard, DashboardCardContent } from "@/components/dashboard-card";
import { ActivityIcon, ZapIcon } from "lucide-react";

export function AiInsight() {
	const coldStartDropPct = 18;

	return (
		<DashboardCard>
			<DashboardCardContent className="flex flex-col justify-between">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2.5 font-medium text-sm">
						<ActivityIcon className="size-4" />
						AI Insight
					</div>
					<Button className="text-muted-foreground" size="sm" variant="ghost">
						<ZapIcon aria-hidden="true" data-icon="inline-start" />
						View traces
					</Button>
				</div>

				<p
					className={cn(
						"text-pretty text-left text-base text-muted-foreground",
						"md:max-w-86 md:text-lg xl:text-2xl"
					)}
				>
					Cold starts fell by{" "}
					<span className="font-medium text-foreground">
						{coldStartDropPct}% in the last 4 hours
					</span>{" "}
					vs. the previous window after the v2.8.1 deploy.
				</p>
				<span />
			</DashboardCardContent>
		</DashboardCard>
	);
}
