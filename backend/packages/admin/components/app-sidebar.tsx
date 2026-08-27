"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { LogoIcon } from "@/components/logo";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	CustomMenuButton,
	isActivePath,
	getActiveSite,
	getActiveSiteId,
	SITES,
} from "@/components/app-shared";
import { CustomSidebarRail } from "@/components/custom-sidebar-rail";
import { NavUser, type SignOutAction } from "@/components/nav-user";
import { BuildingIcon, CheckIcon, ChevronsUpDownIcon } from "lucide-react";

// Admin sidebar — multi-tenant. The top-left switcher moves between the Rhodes
// Enterprises sites this panel manages (Esperanza Homes, Rhodes Living); the active
// site is derived from the URL (see getActiveSite). Each site supplies its own nav
// (entity groups for Esperanza, a single Availability screen for Rhodes Living).
// Active route is highlighted via SidebarMenuButton's data-active state.
//
// `isAdmin` (Auth.js session role === 'admin') reveals the Full-Admin-only Settings
// group (the Field Builder). Non-admins never see it; the route itself is also gated.
export function AppSidebar({
	isAdmin = false,
	email = null,
	signOutAction,
}: {
	isAdmin?: boolean;
	email?: string | null;
	signOutAction: SignOutAction;
}) {
	const pathname = usePathname();
	const isActive = (path?: string) => isActivePath(path, pathname);
	const activeSite = getActiveSite(pathname);
	const activeSiteId = getActiveSiteId(pathname);

	return (
		<Sidebar
			className={cn(
				"*:data-[slot=sidebar-inner]:bg-background",
				"duration-(--sidebar-animation-duration) ease-(--sidebar-animation-ease)"
			)}
			collapsible="icon"
			variant="sidebar"
		>
			{/* Site selector at the TOP (feedback [20], dashboard-1 pattern). Switches
			    between the Rhodes-Enterprises sites; the active site's wordmark shows. */}
			{/* Fixed to the top-bar height so the sidebar header and AppHeader borders line
			    up (feedback [5]). */}
			<SidebarHeader className="relative h-(--app-header-height) justify-center gap-0 border-b px-2">
				<SidebarMenu>
					<SidebarMenuItem>
						<DropdownMenu>
							<DropdownMenuTrigger render={<SidebarMenuButton size="lg" className="gap-2" />}>
								{/* Active site's wordmark. Collapses to a compact glyph when the
								    rail is icon-only (LogoIcon for Esperanza, a building for Rhodes
								    Living — the PNG wordmark can't shrink into the rail). */}
								{/* eslint-disable-next-line @next/next/no-img-element */}
								<img
									src={activeSite.logoSrc}
									alt={activeSite.name}
									className={cn(
										activeSite.logoClassName,
										"w-auto shrink-0 group-data-[collapsible=icon]:hidden"
									)}
								/>
								{activeSiteId === "esperanza" ? (
									<LogoIcon className="hidden size-5 shrink-0 text-primary group-data-[collapsible=icon]:block" />
								) : (
									<BuildingIcon className="hidden size-5 shrink-0 text-primary group-data-[collapsible=icon]:block" />
								)}
								<ChevronsUpDownIcon className="ml-auto size-4 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden" />
							</DropdownMenuTrigger>
							<DropdownMenuContent
								align="start"
								className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
								sideOffset={4}
							>
								<DropdownMenuGroup>
									{/* Parent org = Rhodes; each company below it is its own site. */}
									<DropdownMenuLabel className="flex items-center py-1.5">
										{/* eslint-disable-next-line @next/next/no-img-element */}
										<img src="/rhodes-logo.svg" alt="Rhodes" className="h-3.5 w-auto opacity-80" />
									</DropdownMenuLabel>
									{SITES.map((site) => (
										<DropdownMenuItem
											key={site.id}
											className="gap-2"
											render={<Link href={site.home} />}
										>
											<span className="flex-1">{site.name}</span>
											{site.id === activeSiteId && (
												<CheckIcon className="size-4 text-primary" />
											)}
										</DropdownMenuItem>
									))}
								</DropdownMenuGroup>
							</DropdownMenuContent>
						</DropdownMenu>
					</SidebarMenuItem>
				</SidebarMenu>
				{/* No absolute SidebarTrigger here — it overlapped the selector's click target
				    (feedback [1]). Desktop collapse is handled by CustomSidebarRail; mobile by
				    the trigger in AppHeader. */}
			</SidebarHeader>
			<SidebarContent>
				{activeSite.nav.map((group) => (
					<SidebarGroup key={group.label}>
						<SidebarGroupLabel className="uppercase tracking-wider">
							{group.label}
						</SidebarGroupLabel>
						<SidebarMenu>
							{group.items.map((item) => (
								<SidebarMenuItem key={item.title}>
									<CustomMenuButton
										isActive={isActive(item.path)}
										render={<Link href={item.path ?? "#"} />}
									>
										{item.icon}
										<span>{item.title}</span>
									</CustomMenuButton>
								</SidebarMenuItem>
							))}
						</SidebarMenu>
					</SidebarGroup>
				))}
				{/* Field-Builder settings now live in the account menu (sidebar footer),
				    so the SETTINGS / Fields nav group was removed (feedback). */}
			</SidebarContent>
			{/* Account lives at the BOTTOM of the sidebar (feedback [13][20]). */}
			<SidebarFooter className="border-t">
				<NavUser email={email} signOutAction={signOutAction} isAdmin={isAdmin} />
			</SidebarFooter>
			<CustomSidebarRail />
		</Sidebar>
	);
}
