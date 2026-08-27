"use client";

import { cn } from "@/lib/utils";
import { Command as CommandPrimitive } from "cmdk";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useKeypress } from "@/hooks/use-keypress";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
} from "@/components/ui/empty";
import {
	InputGroup,
	InputGroupAddon,
} from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { mainNavLinks } from "@/components/app-shared";
import { SearchIcon } from "lucide-react";

const groups = mainNavLinks;

const APP_SEARCH_KEYBOARD_COMBO = ["meta+k", "ctrl+k"];
const APP_SEARCH_KEYBOARD_HINT = "⌘K";

export function AppSearch() {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	const wrapperRef = useRef<HTMLDivElement>(null);

	useKeypress({
		combo: APP_SEARCH_KEYBOARD_COMBO,
		callback: () => inputRef.current?.focus(),
	});

	function handleBlur(e: React.FocusEvent) {
		if (wrapperRef.current?.contains(e.relatedTarget as Node)) {
			return;
		}
		setOpen(false);
		setSearch("");
	}

	return (
		// biome-ignore lint: focus-tracking onBlur needed on search landmark
		<search
			className={cn(
				"[--app-search-duration:250ms]",
				"[--app-search-ease:cubic-bezier(0.4,0,0.2,1)]",
				"group relative z-60! h-9 w-32 md:w-72 lg:w-96"
			)}
			data-state={open ? "open" : "closed"}
			onBlur={handleBlur}
			ref={wrapperRef}
		>
			<Command
				className={cn(
					"absolute top-0 right-0 z-60! w-full overflow-visible p-0",
					"group-data-[state=open]:-top-1 group-data-[state=open]:-right-2",
					"w-32 group-data-[state=open]:w-[32rem] md:w-72 lg:w-96",
					"group-data-[state=open]:shadow-md",
					"group-data-[state=closed]:bg-background",
					"h-9 group-data-[state=open]:h-80",
					"border border-transparent group-data-[state=open]:border-border",
					"transition-all duration-(--app-search-duration) ease-(--app-search-ease)"
				)}
				loop
			>
				<InputGroup
					className={cn(
						"relative w-full shrink-0",
						"group-data-[state=open]:h-10",
						"border-border group-data-[state=open]:border-transparent group-data-[state=open]:border-b-border",
						"group-data-[state=open]:rounded-b-none",
						"group-data-[state=open]:bg-transparent",
						"transition-[height,width,border-radius,border-color,background-color] duration-(--app-search-duration) ease-(--app-search-ease)"
					)}
				>
					<InputGroupAddon align="inline-start">
						<SearchIcon
						/>
					</InputGroupAddon>
					<CommandPrimitive.Input
						className="min-w-0 flex-1 outline-none placeholder:text-nowrap placeholder:text-muted-foreground placeholder:text-sm"
						data-slot="command-input"
						onFocus={() => setOpen(true)}
						onKeyDown={(e) => {
							if (e.key === "Escape") {
								inputRef.current?.blur();
							}
						}}
						onValueChange={setSearch}
						placeholder="Find"
						ref={inputRef}
						value={search}
					/>
					<InputGroupAddon align="inline-end" className="hidden md:flex">
						<Kbd
							className={cn(
								"w-8 group-data-[state=open]:w-8",
								"transition-[width] duration-(--app-search-duration) ease-(--app-search-ease)"
							)}
						>
							<span
								className="fade-in-0 animate-in duration-(--app-search-duration) ease-(--app-search-ease)"
								key={open ? "Esc" : APP_SEARCH_KEYBOARD_HINT}
							>
								{open ? "Esc" : APP_SEARCH_KEYBOARD_HINT}
							</span>
						</Kbd>
					</InputGroupAddon>
				</InputGroup>
				<CommandList
					className={cn(
						"opacity-0 group-data-[state=open]:opacity-100",
						"transition-opacity duration-(--app-search-duration) ease-(--app-search-ease)"
					)}
				>
					<CommandEmpty>
						<Empty>
							<EmptyMedia variant="icon">
								<SearchIcon
								/>
							</EmptyMedia>
							<EmptyHeader>No results found.</EmptyHeader>
							<EmptyDescription>
								Try searching for something else.
							</EmptyDescription>
						</Empty>
					</CommandEmpty>
					{groups.map((group) => (
						<CommandGroup heading={group.label} key={group.label}>
							{group.items.map((item) => (
								<CommandItem
									key={item.title}
									onSelect={() => {
										setOpen(false);
										setSearch("");
										inputRef.current?.blur();
										if (item.path) {
											router.push(item.path);
										}
									}}
									value={item.title}
								>
									{item.icon}
									<span>{item.title}</span>
								</CommandItem>
							))}
						</CommandGroup>
					))}
				</CommandList>
			</Command>
		</search>
	);
}
