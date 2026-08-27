"use client";

import Link from "next/link";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "@/components/ui/sidebar";
import { ChevronsUpDownIcon, LogOutIcon, SlidersHorizontalIcon, UsersIcon, PercentIcon } from "lucide-react";

/** Server action wired up by the layout — calls the existing Auth.js signOut. */
export type SignOutAction = () => void | Promise<void>;

function initials(email: string): string {
	const local = email.split("@")[0] ?? email;
	const parts = local.split(/[._-]+/).filter(Boolean);
	if (parts.length >= 2 && parts[0] && parts[1]) {
		return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
	}
	return (local.slice(0, 2) || "?").toUpperCase();
}

/**
 * Sidebar-footer account control (feedback [13][20] — user + settings live at the
 * BOTTOM of the sidebar, dashboard-1 style: large avatar + email row that opens an
 * upward menu with Field settings (admins) + Sign out). Moved here from the top header.
 */
export function NavUser({
	email,
	signOutAction,
	isAdmin = false,
}: {
	email: string | null;
	signOutAction: SignOutAction;
	isAdmin?: boolean;
}) {
	const { isMobile } = useSidebar();
	const display = email ?? "Not signed in";
	const local = email ? (email.split("@")[0] ?? email) : "Not signed in";

	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<DropdownMenu>
					<DropdownMenuTrigger render={<SidebarMenuButton size="lg" />}>
						<Avatar className="size-8 rounded-lg">
							<AvatarFallback className="rounded-lg">
								{email ? initials(email) : "?"}
							</AvatarFallback>
						</Avatar>
						<div className="grid flex-1 text-left text-sm leading-tight">
							<span className="truncate font-medium capitalize">{local}</span>
							<span className="truncate text-muted-foreground text-xs">{display}</span>
						</div>
						<ChevronsUpDownIcon className="ml-auto size-4" />
					</DropdownMenuTrigger>
					<DropdownMenuContent
						align="end"
						className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
						side={isMobile ? "bottom" : "right"}
						sideOffset={4}
					>
						{/* Base UI requires MenuGroupLabel (DropdownMenuLabel) to live inside a
						    DropdownMenuGroup — omitting the wrapper throws MenuGroupContext-missing. */}
						<DropdownMenuGroup>
							<DropdownMenuLabel className="p-0 font-normal">
								<div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
									<Avatar className="size-8 rounded-lg">
										<AvatarFallback className="rounded-lg">
											{email ? initials(email) : "?"}
										</AvatarFallback>
									</Avatar>
									<div className="grid min-w-0 flex-1 leading-tight">
										<span className="truncate font-medium text-foreground">Signed in</span>
										<span className="truncate text-muted-foreground text-xs">{display}</span>
									</div>
								</div>
							</DropdownMenuLabel>
						</DropdownMenuGroup>
						<DropdownMenuSeparator />
						{/* Site settings (Mortgage Rate…) — content values, visible to EVERY
						    signed-in editor, unlike the Full-Admin engine surfaces below. */}
						<DropdownMenuGroup>
							<DropdownMenuItem render={<Link href="/settings/site" />}>
								<PercentIcon />
								Site settings
							</DropdownMenuItem>
						</DropdownMenuGroup>
						<DropdownMenuSeparator />
						{isAdmin ? (
							<>
								<DropdownMenuGroup>
									<DropdownMenuItem render={<Link href="/settings/fields" />}>
										<SlidersHorizontalIcon />
										Field settings
									</DropdownMenuItem>
									<DropdownMenuItem render={<Link href="/settings/users" />}>
										<UsersIcon />
										Users
									</DropdownMenuItem>
								</DropdownMenuGroup>
								<DropdownMenuSeparator />
							</>
						) : null}
						<form action={signOutAction} className="w-full">
							<DropdownMenuItem
								className="w-full cursor-pointer"
								render={<button className="w-full" type="submit" />}
								variant="destructive"
							>
								<LogOutIcon />
								Sign out
							</DropdownMenuItem>
						</form>
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
