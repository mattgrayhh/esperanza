"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronsUpDownIcon, PlusIcon, CheckIcon } from "lucide-react";

/** project row for the workspace switcher (registry / demo data). */
export type ProjectType = {
	id: string;
	name: string;
	slug: string;
	/** Logo id or URL fragment passed to `getAvatarUrl`. */
	logo: string | null;
	/** Shown under the org name, e.g. "Free", "Pro". */
	plan?: string;
};

interface Props {
	activeProjectId: string;
	projects: ProjectType[];
}

export function Projects({ activeProjectId, projects }: Props) {
	const activeProject =
		projects.find((project) => project.id === activeProjectId) || projects[0];

	if (!activeProject) {
		return null;
	}

	return (
		<div className="flex w-full items-center justify-between gap-2">
			<a
				className="flex w-max items-center gap-2 text-muted-foreground hover:text-foreground"
				href="#"
			>
				<Avatar className="size-4 md:size-5">
					<AvatarImage
						alt={activeProject.name}
						src={activeProject.logo as string}
					/>
					<AvatarFallback className="text-xs">
						{activeProject.name.charAt(0)}
					</AvatarFallback>
				</Avatar>
				<span className="truncate font-medium text-xs md:text-sm">
					{activeProject.name}{" "}
				</span>
				<Badge variant="secondary">{activeProject.plan || "free"}</Badge>
			</a>
			<DropdownMenu>
				<DropdownMenuTrigger render={<Button aria-label="Switch project" size="icon-xs" variant="ghost" />}><ChevronsUpDownIcon aria-hidden="true" className="size-3.5! text-muted-foreground" /></DropdownMenuTrigger>
				<DropdownMenuContent
					align="end"
					alignOffset={-110}
					className="w-[18rem] p-1"
					sideOffset={4}
				>
					<ProjectsList currentId={activeProjectId} projects={projects} />
					<DropdownMenuSeparator />
					<DropdownMenuItem className="cursor-pointer text-muted-foreground">
						<PlusIcon
						/>
						Create new Project
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

function ProjectsList({
	projects,
	currentId,
}: {
	projects: ProjectType[];
	currentId: string;
}) {
	return (
		<>
			<DropdownMenuLabel className="uppercase">Projects</DropdownMenuLabel>
			<div className="max-h-92 min-h-48 overflow-y-auto">
				<DropdownMenuGroup>
					{projects.map((project) => {
						const planLabel = project.plan ?? "Free";
						const isCurrent = currentId === project.id;

						return (
							<DropdownMenuItem
								className={cn(
									"relative flex w-full items-center gap-x-2 px-2 py-1.5",
									isCurrent &&
										"bg-sidebar-accent text-sidebar-accent-foreground"
								)}
								key={project.id}
							>
								<Avatar className="size-7">
									<AvatarImage
										alt={project.name}
										src={project.logo as string}
									/>
									<AvatarFallback className="text-xs">
										{project.name.charAt(0)}
									</AvatarFallback>
								</Avatar>
								<div className="flex min-w-0 flex-1 flex-col items-start justify-center">
									<div className="grid w-full flex-1 text-left text-sm leading-tight">
										<span className="truncate">{project.name}</span>
									</div>
									<span className="text-xs opacity-60">{planLabel}</span>
								</div>
								{isCurrent && (
									<CheckIcon aria-hidden="true" className="ml-auto size-4 shrink-0" />
								)}
							</DropdownMenuItem>
						);
					})}
				</DropdownMenuGroup>
			</div>
		</>
	);
}
