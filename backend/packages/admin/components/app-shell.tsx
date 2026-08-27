import { cn } from "@/lib/utils";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppHeader } from "@/components/app-header";
import { AppSidebar } from "@/components/app-sidebar";
import { ContentBorder } from "@/components/content-border";
import type { SignOutAction } from "@/components/nav-user";

export function AppShell({
	children,
	email,
	isAdmin = false,
	signOutAction,
}: {
	children: React.ReactNode;
	email: string | null;
	/** Full Admin — gates the Settings → Fields nav entry. */
	isAdmin?: boolean;
	signOutAction: SignOutAction;
}) {
	return (
		<SidebarProvider
			className={cn(
				"[--sidebar-animation-duration:250ms]",
				"[--app-header-height:3.5rem]",
				/* Full-width content (feedback: "still not full width", "squished in the
				   middle 1/3"). Was 64rem — capped content to ~1024px, leaving large gutters
				   on wide monitors. `none` lets the inset fill the available width (minus the
				   p-4/md:p-6 padding), matching the reference dashboard density. */
				"[--app-wrapper-max-width:none]",
				"[--sidebar-animation-ease:ease-[cubic-bezier(0.32,0.72,0,1)]]",
				"**:data-[slot=sidebar-gap]:duration-(--sidebar-animation-duration) **:data-[slot=sidebar-gap]:ease-(--sidebar-animation-ease)"
			)}
		>
			<AppSidebar isAdmin={isAdmin} email={email} signOutAction={signOutAction} />
			<SidebarInset>
				<AppHeader />
				<div className="mx-auto flex w-full max-w-(--app-wrapper-max-width) flex-1 flex-col gap-4 p-4 md:p-6">
					{children}
				</div>
				<ContentBorder />
			</SidebarInset>
		</SidebarProvider>
	);
}
