"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import {
	Combobox,
	ComboboxChip,
	ComboboxChips,
	ComboboxChipsInput,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxItem,
	ComboboxList,
	useComboboxAnchor,
} from "~/components/ui/combobox";
import { Input } from "~/components/ui/input";
import { api } from "~/trpc/react";

export function ReportingGroupsClient() {
	const utils = api.useUtils();
	const { data: users = [], isLoading: usersLoading } =
		api.reporting.listUsers.useQuery();
	const { data: groups = [], isLoading: groupsLoading } =
		api.reporting.listGroupDetails.useQuery();

	const createGroup = api.reporting.createGroup.useMutation({
		onSuccess: async () => {
			await utils.reporting.listGroupDetails.invalidate();
			await utils.reporting.listGroups.invalidate();
			toast.success("Gruppe erstellt.");
		},
		onError: () => {
			toast.error("Gruppe konnte nicht erstellt werden.");
		},
	});
	const updateGroup = api.reporting.updateGroup.useMutation({
		onSuccess: async () => {
			await utils.reporting.listGroupDetails.invalidate();
			await utils.reporting.listGroups.invalidate();
			toast.success("Gruppe aktualisiert.");
		},
		onError: () => {
			toast.error("Gruppe konnte nicht aktualisiert werden.");
		},
	});
	const deleteGroup = api.reporting.deleteGroup.useMutation({
		onSuccess: async () => {
			await utils.reporting.listGroupDetails.invalidate();
			await utils.reporting.listGroups.invalidate();
			toast.success("Gruppe gelöscht.");
		},
		onError: () => {
			toast.error("Gruppe konnte nicht gelöscht werden.");
		},
	});

	const [dialogOpen, setDialogOpen] = useState(false);
	const [newTitle, setNewTitle] = useState("");
	const [newMemberIds, setNewMemberIds] = useState<string[]>([]);
	const [newViewerIds, setNewViewerIds] = useState<string[]>([]);
	const [drafts, setDrafts] = useState<
		Record<string, { title: string; memberIds: string[]; viewerIds: string[] }>
	>({});

	useEffect(() => {
		const next: Record<
			string,
			{ title: string; memberIds: string[]; viewerIds: string[] }
		> = {};
		for (const group of groups) {
			next[group.id] = {
				title: group.title,
				memberIds: group.memberIds,
				viewerIds: group.viewerIds,
			};
		}

		setDrafts((prev) => {
			const prevKeys = Object.keys(prev);
			const nextKeys = Object.keys(next);
			if (prevKeys.length !== nextKeys.length) return next;
			for (const key of nextKeys) {
				const prevEntry = prev[key];
				const nextEntry = next[key];
				if (!prevEntry || !nextEntry) return next;
				if (prevEntry.title !== nextEntry.title) return next;
				if (
					prevEntry.memberIds.length !== nextEntry.memberIds.length ||
					prevEntry.viewerIds.length !== nextEntry.viewerIds.length
				) {
					return next;
				}
				if (
					[...prevEntry.memberIds].sort().join("|") !==
						[...nextEntry.memberIds].sort().join("|") ||
					[...prevEntry.viewerIds].sort().join("|") !==
						[...nextEntry.viewerIds].sort().join("|")
				) {
					return next;
				}
			}
			return prev;
		});
	}, [groups]);

	const usersReady = !usersLoading && users.length > 0;
	const groupsReady = !groupsLoading && groups.length > 0;

	const canCreate = newTitle.trim().length > 0;

	const userMap = useMemo(() => {
		const map = new Map<string, string>();
		for (const user of users) {
			map.set(user.id, user.name ?? user.id);
		}
		return map;
	}, [users]);

	return (
		<div className="flex flex-col gap-8">
			<div className="flex flex-wrap items-center justify-between gap-3 rounded-none border border-border bg-card p-5">
				<div>
					<h2 className="font-medium text-sm">Neue Abrechnungsgruppe</h2>
					<p className="text-muted-foreground text-xs">
						Lege neue Gruppen für das Reporting an.
					</p>
				</div>
				<Button
					onClick={() => {
						setDialogOpen((prev) => !prev);
						if (dialogOpen) {
							setNewTitle("");
							setNewMemberIds([]);
							setNewViewerIds([]);
							createGroup.reset();
						}
					}}
					variant={dialogOpen ? "outline" : "default"}
				>
					{dialogOpen ? "Eingabe schließen" : "Neue Gruppe anlegen"}
				</Button>
			</div>
			{dialogOpen ? (
				<div className="rounded-none border border-border bg-card p-5">
					<div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,2fr)]">
						<div className="space-y-3">
							<label
								className="font-medium text-muted-foreground text-xs"
								htmlFor="new-group-title"
							>
								Titel
							</label>
							<Input
								id="new-group-title"
								onChange={(event) => setNewTitle(event.target.value)}
								placeholder="z.B. Produktteam"
								value={newTitle}
							/>
						</div>
						<div className="grid gap-4 md:grid-cols-2">
							<UserCombobox
								description="Benutzer, deren Nutzung im Bericht enthalten ist."
								label="Mitglieder"
								onChange={setNewMemberIds}
								selected={newMemberIds}
								users={users}
							/>
							<UserCombobox
								description="Benutzer, die diese Gruppe im Reporting sehen dürfen."
								label="Berechtigte"
								onChange={setNewViewerIds}
								selected={newViewerIds}
								users={users}
							/>
						</div>
					</div>
					<div className="mt-4 flex flex-wrap items-center gap-2">
						<Button
							disabled={!canCreate || createGroup.isPending}
							onClick={() => {
								createGroup.mutate({
									title: newTitle.trim(),
									memberIds: newMemberIds,
									viewerIds: newViewerIds,
								});
								setDialogOpen(false);
								setNewTitle("");
								setNewMemberIds([]);
								setNewViewerIds([]);
								createGroup.reset();
							}}
						>
							{createGroup.isPending ? "Wird erstellt..." : "Gruppe anlegen"}
						</Button>
						<Button
							onClick={() => {
								setDialogOpen(false);
								setNewTitle("");
								setNewMemberIds([]);
								setNewViewerIds([]);
								createGroup.reset();
							}}
							variant="outline"
						>
							Abbrechen
						</Button>
						{createGroup.error ? (
							<span className="text-destructive text-xs">
								Gruppe konnte nicht erstellt werden.
							</span>
						) : null}
					</div>
				</div>
			) : null}

			<div className="grid gap-6">
				{groupsReady ? (
					groups.map((group) => {
						const draft = drafts[group.id] ?? {
							title: group.title,
							memberIds: group.memberIds,
							viewerIds: group.viewerIds,
						};
						const canSave = draft.title.trim().length > 0;
						const memberNames = draft.memberIds
							.map((id) => userMap.get(id) ?? id)
							.join(", ");
						const viewerNames = draft.viewerIds
							.map((id) => userMap.get(id) ?? id)
							.join(", ");

						return (
							<div
								className="rounded-none border border-border bg-card p-5"
								key={group.id}
							>
								<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
									<div>
										<div className="text-muted-foreground text-xs">Gruppe</div>
										<h3 className="font-medium text-base">{group.title}</h3>
									</div>
									<div className="flex flex-wrap gap-2">
										<Button
											disabled={!canSave || updateGroup.isPending}
											onClick={() => {
												updateGroup.mutate({
													id: group.id,
													title: draft.title.trim(),
													memberIds: draft.memberIds,
													viewerIds: draft.viewerIds,
												});
											}}
											size="sm"
										>
											Änderungen speichern
										</Button>
										<Button
											disabled={deleteGroup.isPending}
											onClick={() => deleteGroup.mutate({ id: group.id })}
											size="sm"
											variant="outline"
										>
											Löschen
										</Button>
									</div>
								</div>
								<div className="mt-4 grid gap-4 lg:grid-cols-[1fr_minmax(0,2fr)]">
									<div className="space-y-3">
										<label
											className="font-medium text-muted-foreground text-xs"
											htmlFor={`group-title-${group.id}`}
										>
											Titel
										</label>
										<Input
											id={`group-title-${group.id}`}
											onChange={(event) =>
												setDrafts((prev) => ({
													...prev,
													[group.id]: {
														...draft,
														title: event.target.value,
													},
												}))
											}
											value={draft.title}
										/>
										<div className="text-[11px] text-muted-foreground">
											Mitglieder: {memberNames || "—"}
										</div>
										<div className="text-[11px] text-muted-foreground">
											Berechtigte: {viewerNames || "—"}
										</div>
									</div>
									<div className="grid gap-4 md:grid-cols-2">
										<UserCombobox
											description="Benutzer, die im Bericht ausgewiesen werden."
											label="Mitglieder"
											onChange={(next) =>
												setDrafts((prev) => ({
													...prev,
													[group.id]: {
														...draft,
														memberIds: next,
													},
												}))
											}
											selected={draft.memberIds}
											users={users}
										/>
										<UserCombobox
											description="Benutzer, die Reports dieser Gruppe sehen dürfen."
											label="Berechtigte"
											onChange={(next) =>
												setDrafts((prev) => ({
													...prev,
													[group.id]: {
														...draft,
														viewerIds: next,
													},
												}))
											}
											selected={draft.viewerIds}
											users={users}
										/>
									</div>
								</div>
							</div>
						);
					})
				) : groupsLoading ? (
					<div className="rounded-none border border-border bg-card p-6 text-muted-foreground text-sm">
						Abrechnungsgruppen werden geladen ...
					</div>
				) : (
					<div className="rounded-none border border-border bg-card p-6 text-muted-foreground text-sm">
						Noch keine Abrechnungsgruppen vorhanden.
					</div>
				)}
			</div>
			{!usersReady ? (
				<div className="rounded-none border border-border bg-card p-6 text-muted-foreground text-sm">
					Benutzer werden geladen ...
				</div>
			) : null}
		</div>
	);
}

function UserCombobox({
	label,
	description,
	users,
	selected,
	onChange,
}: {
	label: string;
	description: string;
	users: Array<{ id: string; name: string | null }>;
	selected: string[];
	onChange: (ids: string[]) => void;
}) {
	const anchorRef = useComboboxAnchor();
	const [inputValue, setInputValue] = useState("");
	const userMap = useMemo(() => {
		const map = new Map<string, string>();
		for (const user of users) {
			map.set(user.id, user.name ?? user.id);
		}
		return map;
	}, [users]);
	const filteredUsers = useMemo(() => {
		const query = inputValue.trim().toLowerCase();
		if (!query) return users;
		return users.filter((user) => {
			const displayName = (user.name ?? user.id).toLowerCase();
			return (
				displayName.includes(query) || user.id.toLowerCase().includes(query)
			);
		});
	}, [inputValue, users]);

	return (
		<div className="rounded-none border border-border p-3">
			<div className="font-medium text-muted-foreground text-xs">{label}</div>
			<p className="mt-1 text-[11px] text-muted-foreground">{description}</p>
			<div className="mt-3">
				<Combobox
					inputValue={inputValue}
					items={filteredUsers.map((user) => ({
						value: user.id,
						label: user.name ?? user.id,
					}))}
					itemToStringValue={(value) =>
						userMap.get(String(value)) ?? String(value)
					}
					multiple
					onInputValueChange={(value) => {
						const next =
							typeof value === "string"
								? value
								: (value as { inputValue?: string } | null)?.inputValue;
						setInputValue(String(next ?? ""));
					}}
					onValueChange={(value) => {
						onChange(Array.isArray(value) ? value : []);
						setInputValue("");
					}}
					value={selected}
				>
					<ComboboxChips ref={anchorRef}>
						{selected.map((id) => (
							<ComboboxChip key={id}>{userMap.get(id) ?? id}</ComboboxChip>
						))}
						<ComboboxChipsInput
							onChange={(event) => setInputValue(event.target.value)}
							placeholder="Benutzer auswählen"
							value={inputValue}
						/>
					</ComboboxChips>
					<ComboboxContent anchor={anchorRef}>
						<ComboboxList>
							{(item) => (
								<ComboboxItem key={item.value} value={item.value}>
									{item.label ?? item.value}
								</ComboboxItem>
							)}
						</ComboboxList>
						<ComboboxEmpty>Keine Benutzer gefunden.</ComboboxEmpty>
					</ComboboxContent>
				</Combobox>
			</div>
		</div>
	);
}
