// =============================================================================
// Status page — shared health types/helpers + the LIVE snapshot builder.
// =============================================================================

export type ComponentHealth = "operational" | "degraded" | "outage" | "maintenance";

export type StatusComponent = {
	id: string;
	name: string;
	description?: string;
	status: ComponentHealth;
	/** Live one-line detail (e.g. "Last good run 0.8h ago"). */
	detail?: string;
	/** 0–100 uptime over the lookback window (history feed not wired — empty hides the bar). */
	uptimePct: number;
	/** One bucket per day in the lookback (true = up that day). Empty = no bar. */
	uptimeDays: boolean[];
};

export type StatusGroup = {
	id: string;
	name: string;
	description?: string;
	components: StatusComponent[];
};

export type StatusSnapshot = {
	updatedAt: string;
	lookbackDays: number;
	overall: ComponentHealth;
	groups: StatusGroup[];
	/** Website ping cadence — placeholder until a real checker exists. */
	websitePingNote: string;
	/** Data source note shown on the page. */
	sourceNote: string;
};

const LOOKBACK_DAYS = 90;

const HEALTH_RANK: Record<ComponentHealth, number> = {
	operational: 0,
	maintenance: 1,
	degraded: 2,
	outage: 3,
};

export function worstHealth(...statuses: ComponentHealth[]): ComponentHealth {
	return statuses.reduce((worst, next) =>
		HEALTH_RANK[next] > HEALTH_RANK[worst] ? next : worst
	);
}

export function healthLabel(status: ComponentHealth): string {
	switch (status) {
		case "operational":
			return "Operational";
		case "degraded":
			return "Degraded";
		case "outage":
			return "Outage";
		case "maintenance":
			return "Maintenance";
	}
}

export function overallBannerCopy(status: ComponentHealth): string {
	switch (status) {
		case "operational":
			return "All Systems Operational";
		case "degraded":
			return "Partial System Outage";
		case "outage":
			return "Major System Outage";
		case "maintenance":
			return "Scheduled Maintenance";
	}
}

/** Indicator color for StatusIndicator / header pill. */
export function healthIndicatorColor(
	status: ComponentHealth
): "brand" | "emerald" | "amber" | "rose" | "sky" {
	switch (status) {
		case "operational":
			return "brand";
		case "degraded":
			return "amber";
		case "outage":
			return "rose";
		case "maintenance":
			return "sky";
	}
}

/**
 * LIVE snapshot — one component per real check (lib/status-live.ts). No uptime
 * history is stored yet, so uptimeDays stays empty and the view hides the bar.
 */
export async function getStatusSnapshot(env?: { OPS?: Fetcher }): Promise<StatusSnapshot> {
	const { loadLiveChecks } = await import('./status-live');
	const checks = await loadLiveChecks(env);
	const groups: StatusGroup[] = [
		{
			id: 'live',
			name: 'Live checks',
			description: 'Checked from the admin worker on every page load.',
			components: checks.map((c) => ({
				id: c.id,
				name: c.name,
				description: c.description,
				status: c.status,
				detail: c.detail,
				uptimePct: 100,
				uptimeDays: [],
			})),
		},
	];
	const overall = worstHealth(...groups.flatMap((g) => g.components.map((c) => c.status)));
	return {
		updatedAt: new Date().toISOString(),
		lookbackDays: LOOKBACK_DAYS,
		overall,
		groups,
		websitePingNote: '',
		sourceNote: '',
	};
}
