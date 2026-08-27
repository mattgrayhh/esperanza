"use client";
import { SidebarRail, useSidebar } from "@/components/ui/sidebar";

export function CustomSidebarRail() {
	const { open } = useSidebar();

	if (open) {
		return null;
	}

	return (
		<SidebarRail className="hover:group-data-[collapsible=offExamples]:bg-transparent [[data-side=left][data-collapsible=offExamples]_&]:-right-1" />
	);
}
