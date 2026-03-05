"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { api } from "~/trpc/react";

const toggleValue = (values: string[], value: string) =>
	values.includes(value)
		? values.filter((item) => item !== value)
		: [...values, value];

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
		},
	});
	const updateGroup = api.reporting.updateGroup.useMutation({
		onSuccess: async () => {
			await utils.reporting.listGroupDetails.invalidate();
			await utils.reporting.listGroups.invalidate();
		},
	});
	const deleteGroup = api.reporting.deleteGroup.useMutation({
		onSuccess: async () => {
			await utils.reporting.listGroupDetails.invalidate();
			await utils.reporting.listGroups.invalidate();
		},
	});

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
		setDrafts(next);
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
			<div className="rounded-none border border-border bg-card p-5">
				<h2 className="font-medium text-sm">Neue Abrechnungsgruppe</h2>
				<div className="mt-4 grid gap-4 lg:grid-cols-[1fr_minmax(0,2fr)]">
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
						<div className="flex gap-2">
							<Button
								disabled={!canCreate || createGroup.isPending}
								onClick={() => {
									createGroup.mutate({
										title: newTitle.trim(),
										memberIds: newMemberIds,
										viewerIds: newViewerIds,
									});
									setNewTitle("");
									setNewMemberIds([]);
									setNewViewerIds([]);
								}}
							>
								Gruppe anlegen
							</Button>
						</div>
					</div>
					<div className="grid gap-4 md:grid-cols-2">
						<UserChecklist
							description="Benutzer, deren Nutzung im Bericht enthalten ist."
							label="Mitglieder"
							onToggle={(id) =>
								setNewMemberIds((prev) => toggleValue(prev, id))
							}
							selected={newMemberIds}
							users={users}
						/>
						<UserChecklist
							description="Benutzer, die diese Gruppe im Reporting sehen dürfen."
							label="Berechtigte"
							onToggle={(id) =>
								setNewViewerIds((prev) => toggleValue(prev, id))
							}
							selected={newViewerIds}
							users={users}
						/>
					</div>
				</div>
			</div>

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
										<UserChecklist
											description="Benutzer, die im Bericht ausgewiesen werden."
											label="Mitglieder"
											onToggle={(id) =>
												setDrafts((prev) => ({
													...prev,
													[group.id]: {
														...draft,
														memberIds: toggleValue(draft.memberIds, id),
													},
												}))
											}
											selected={draft.memberIds}
											users={users}
										/>
										<UserChecklist
											description="Benutzer, die Reports dieser Gruppe sehen dürfen."
											label="Berechtigte"
											onToggle={(id) =>
												setDrafts((prev) => ({
													...prev,
													[group.id]: {
														...draft,
														viewerIds: toggleValue(draft.viewerIds, id),
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

function UserChecklist({
	label,
	description,
	users,
	selected,
	onToggle,
}: {
	label: string;
	description: string;
	users: Array<{ id: string; name: string | null }>;
	selected: string[];
	onToggle: (id: string) => void;
}) {
	return (
		<div className="rounded-none border border-border p-3">
			<div className="font-medium text-muted-foreground text-xs">{label}</div>
			<p className="mt-1 text-[11px] text-muted-foreground">{description}</p>
			<div className="mt-3 max-h-48 space-y-2 overflow-y-auto pr-1">
				{users.map((user) => (
					<label className="flex items-center gap-2 text-xs" key={user.id}>
						<input
							checked={selected.includes(user.id)}
							onChange={() => onToggle(user.id)}
							type="checkbox"
						/>
						<span className="truncate">{user.name ?? user.id}</span>
					</label>
				))}
				{!users.length ? (
					<div className="text-[11px] text-muted-foreground">
						Keine Benutzer verfügbar.
					</div>
				) : null}
			</div>
		</div>
	);
}
