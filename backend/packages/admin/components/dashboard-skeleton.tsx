import { cn } from "@/lib/utils";

export function DashboardSkeleton() {
	return (
		<div className="py-6">
			<div className="flex flex-col px-4 pb-4 md:px-6">
				<h1 className="font-semibold text-2xl">Hey There! 👋</h1>
				<p className="text-lg text-muted-foreground">Welcome back, Shaban!</p>
			</div>
			<div
				className={cn(
					"[--card-padding:1rem]",
					"relative grid grid-cols-2 gap-px bg-border py-px lg:grid-cols-4"
				)}
			>
				{Array.from({ length: 4 }).map((_, index) => (
					<BordersCard className="min-h-40" key={index} />
				))}
				<BordersCard className="col-span-2 min-h-96 lg:col-span-3" />
				<BordersCard className="col-span-2 min-h-96 lg:col-span-1" />
				<BordersCard className="col-span-2 min-h-114 lg:col-span-4" />
			</div>
		</div>
	);
}

function BordersCard({
	className,
	children,
	...props
}: React.ComponentProps<"div">) {
	return (
		<div
			className={cn(
				"relative w-full overflow-hidden bg-background p-(--card-padding)",
				className
			)}
			{...props}
		>
			{children}
			<div className="absolute inset-[calc(var(--card-padding)-1px)] z-0">
				<div className="absolute top-0 left-1/2 h-px w-[200%] -translate-x-1/2 border-t border-dashed" />
				<div className="absolute bottom-0 left-1/2 h-px w-[200%] -translate-x-1/2 border-b border-dashed" />
				<div className="absolute top-1/2 left-0 h-[200%] w-px -translate-y-1/2 border-l border-dashed" />
				<div className="absolute top-1/2 right-0 h-[200%] w-px -translate-y-1/2 border-r border-dashed" />
			</div>
		</div>
	);
}
