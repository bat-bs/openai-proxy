"use client";
import { CircleHelp } from "lucide-react";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { api } from "~/trpc/react";

const assignmentLabels: Record<string, string> = {
	model: "Modell",
	requestType: "Anfrageart",
	billingUnit: "Abrechnungseinheit",
	tokenType: "Token-Typ",
	stageMinTokens: "Stufe ab Tokens",
	stageMaxTokens: "Stufe bis Tokens",
};
const classificationLabels: Record<string, string> = {
	insert: "Automatisch einfügen",
	older: "Automatisch überspringen (älter)",
	unchanged: "Unverändert lassen",
	conflict: "Konflikt – Entscheidung erforderlich",
};

export function AzurePricingClient() {
	const utils = api.useUtils();
	const rulesFileInput = useRef<HTMLInputElement>(null);
	const { data, isLoading } = api.admin.azurePricing.useQuery();
	const [config, setConfig] = useState({
		serviceName: "Azure OpenAI",
		armRegionName: "",
		currencyCode: "EUR",
		productName: "",
		armSkuName: "",
		meterName: "",
	});
	const [auditId, setAuditId] = useState<number | null>(null);
	useEffect(() => {
		if (data?.config)
			setConfig({
				...data.config,
				productName: data.config.productName ?? "",
				armSkuName: data.config.armSkuName ?? "",
				meterName: data.config.meterName ?? "",
			});
	}, [data?.config]);
	const [preview, setPreview] = useState<
		Array<{
			raw: Record<string, unknown>;
			status: string;
			errors?: string[];
			decision: "skip" | "replace" | "ignore";
			assignments?: Record<string, unknown>;
			matchingRuleNames?: string[];
			normalized?:
				| {
						price: number;
						validFrom: string;
						currency: string;
						unitOfMessure: string;
				  }
				| { error: string };
			classification?: "insert" | "older" | "unchanged" | "conflict";
			index: number;
			conflict?: string;
			baseStatus?: string;
		}>
	>([]);
	const save = api.admin.saveAzurePricingConfig.useMutation({
		onSuccess: () => {
			toast.success("Konfiguration gespeichert.");
			void utils.admin.azurePricing.invalidate();
		},
		onError: (error) => toast.error(error.message),
	});
	const fetchPrices = api.admin.fetchAzurePricing.useMutation({
		onSuccess: (result) => {
			setAuditId(result.auditId ?? null);
			setPreview(result.rows);
			toast.success(`${result.rows.length} Azure-Zeilen geladen.`);
		},
		onError: (error) => toast.error(error.message),
	});
	const createRule = api.admin.createAzurePricingRule.useMutation({
		onSuccess: () => {
			toast.success("Regel gespeichert.");
			void utils.admin.azurePricing.invalidate();
		},
	});
	const updateRule = api.admin.updateAzurePricingRule.useMutation({
		onSuccess: () => void utils.admin.azurePricing.invalidate(),
	});
	const deleteRule = api.admin.deleteAzurePricingRule.useMutation({
		onSuccess: () => void utils.admin.azurePricing.invalidate(),
	});
	const importRules = api.admin.importAzurePricingRules.useMutation({
		onSuccess: (result) => {
			toast.success(`${result.count} Regeln importiert.`);
			void utils.admin.azurePricing.invalidate();
		},
		onError: (error) => toast.error(error.message),
	});
	const { data: audits = [] } = api.admin.listAzurePricingAudits.useQuery();
	const [ruleName, setRuleName] = useState("");
	const [rulePriority, setRulePriority] = useState("0");
	const [ruleAction, setRuleAction] = useState<"map" | "ignore">("map");
	const [ruleConditions, setRuleConditions] = useState("[]");
	const [ruleAssignments, setRuleAssignments] = useState("{}");
	const [editingRuleId, setEditingRuleId] = useState<number | null>(null);
	const [selectedRuleIds, setSelectedRuleIds] = useState<Set<number>>(
		new Set(),
	);
	const [helpOpen, setHelpOpen] = useState(false);
	const [showIgnoredRows, setShowIgnoredRows] = useState(false);
	const [selectedAuditId, setSelectedAuditId] = useState<number | null>(null);
	const { data: selectedAudit } = api.admin.getAzurePricingAudit.useQuery(
		{ id: selectedAuditId ?? 0 },
		{ enabled: selectedAuditId !== null },
	);
	const importer = api.admin.importAzurePricing.useMutation({
		onSuccess: (result) => {
			setPreview((currentRows) =>
				currentRows.map((row) => {
					const outcome = result.find((item) => item.index === row.index);
					if (!outcome) return row;
					const status =
						outcome.status === "insert"
							? "inserted"
							: outcome.status === "replace"
								? "replaced"
								: outcome.status;
					return { ...row, status, baseStatus: status };
				}),
			);
			toast.success("Import abgeschlossen.");
		},
		onError: (error) => toast.error(error.message),
	});
	const exportRules = () => {
		const rules = (data?.rules ?? [])
			.filter((rule) => selectedRuleIds.has(rule.id))
			.map((rule) => ({
				name: rule.name,
				enabled: rule.enabled,
				priority: rule.priority,
				action: rule.action,
				conditions: rule.conditions,
				assignments: rule.assignments,
			}));
		if (!rules.length) {
			toast.error("Bitte mindestens eine Regel auswählen.");
			return;
		}
		const blob = new Blob(
			[
				JSON.stringify(
					{
						formatVersion: 1,
						rules,
					},
					null,
					2,
				),
			],
			{ type: "application/json" },
		);
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = `azure-pricing-rules-${new Date()
			.toISOString()
			.slice(0, 10)}.json`;
		link.click();
		URL.revokeObjectURL(url);
	};
	const importRuleFile = async (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		event.target.value = "";
		if (!file) return;
		try {
			const parsed: unknown = JSON.parse(await file.text());
			const rules = Array.isArray(parsed)
				? parsed
				: parsed &&
						typeof parsed === "object" &&
						"rules" in parsed &&
						Array.isArray(parsed.rules)
					? parsed.rules
					: undefined;
			if (!rules?.length) throw new Error("Die Datei enthält keine Regeln.");
			importRules.mutate({ rules: rules as never });
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: "Die Regeldatei konnte nicht gelesen werden.",
			);
		}
	};
	if (isLoading)
		return <div className="p-8">Lade Azure-Preiskonfiguration …</div>;
	const current = config;
	const visiblePreview = showIgnoredRows
		? preview
		: preview.filter((row) => row.status !== "ignored");
	return (
		<main className="mx-auto w-full max-w-6xl space-y-6 px-6 py-10">
			<div>
				<h1 className="font-semibold text-2xl">Azure Retail Pricing Import</h1>
				<p className="text-muted-foreground text-sm">
					Manueller, administrativer Import von Azure OpenAI Preisen.
				</p>
			</div>
			<section className="space-y-4 rounded-lg border p-6">
				<h2 className="font-semibold">Globale Abfragekonfiguration</h2>
				<div className="grid gap-3 md:grid-cols-3">
					{(
						[
							"serviceName",
							"armRegionName",
							"currencyCode",
							"productName",
							"armSkuName",
							"meterName",
						] as const
					).map((field) => (
						<label
							className="flex flex-col gap-1 text-sm"
							htmlFor={`azure-${field}`}
							key={field}
						>
							{field}
							<Input
								id={`azure-${field}`}
								onChange={(event) =>
									setConfig({ ...config, [field]: event.target.value })
								}
								required={field === "armRegionName" || field === "currencyCode"}
								value={current[field] ?? ""}
							/>
						</label>
					))}
				</div>
				<div className="flex gap-2">
					<Button
						onClick={() =>
							save.mutate({
								...config,
								productName: config.productName || null,
								armSkuName: config.armSkuName || null,
								meterName: config.meterName || null,
							})
						}
					>
						Konfiguration speichern
					</Button>
					<Button onClick={() => fetchPrices.mutate()} variant="outline">
						Azure laden
					</Button>
				</div>
			</section>
			<section className="rounded-lg border p-6">
				<div className="mb-3 flex items-center justify-between gap-3">
					<h2 className="font-semibold">Vorschau</h2>
					<label className="flex items-center gap-2 text-sm">
						<input
							checked={showIgnoredRows}
							onChange={(event) => setShowIgnoredRows(event.target.checked)}
							type="checkbox"
						/>
						Ignorierte Zeilen anzeigen
					</label>
				</div>
				<p className="mb-4 text-muted-foreground text-sm">
					Nicht gemappte oder ungültige Zeilen müssen ausdrücklich ignoriert
					werden.
				</p>
				<div className="overflow-auto">
					<table className="w-full text-left text-sm">
						<thead>
							<tr>
								<th>Status</th>
								<th>Meter</th>
								<th>Produkt</th>
								<th>Azure ab</th>
								<th>Gematchte Regeln</th>
								<th>Mapping</th>
								<th>Konflikt</th>
								<th>Entscheidung</th>
								<th>Rohdaten</th>
							</tr>
						</thead>
						<tbody>
							{visiblePreview.map((row) => (
								<tr
									className="border-t"
									key={String(row.raw.meterId) + "-" + row.index}
								>
									<td className="py-2">
										{row.status}
										{row.classification
											? ` · ${classificationLabels[row.classification]}`
											: ""}
										{row.errors?.length ? `: ${row.errors.join(", ")}` : ""}
									</td>
									<td>{String(row.raw.meterName ?? "")}</td>
									<td>{String(row.raw.productName ?? "")}</td>
									<td>
										{row.normalized && "validFrom" in row.normalized
											? row.normalized.validFrom
											: String(row.raw.effectiveStartDate ?? "—")}
									</td>
									<td>
										{row.matchingRuleNames?.length
											? row.matchingRuleNames.join(", ")
											: "—"}
									</td>
									<td>
										{(row.assignments &&
											Object.keys(row.assignments).length > 0) ||
										(row.normalized && "validFrom" in row.normalized) ? (
											<div className="min-w-52 space-y-1 text-xs">
												{row.assignments &&
													Object.entries(row.assignments).map(
														([field, value]) => (
															<div className="flex gap-2" key={field}>
																<span className="font-medium">
																	{assignmentLabels[field] ?? field}:
																</span>
																<span>
																	{value === null ? "—" : String(value)}
																</span>
															</div>
														),
													)}
												{row.normalized && "validFrom" in row.normalized && (
													<>
														<div className="flex gap-2">
															<span className="font-medium">Preis:</span>
															<span>{row.normalized.price} Cent</span>
														</div>
														<div className="flex gap-2">
															<span className="font-medium">Einheit:</span>
															<span>{row.normalized.unitOfMessure}</span>
														</div>
														<div className="flex gap-2">
															<span className="font-medium">Währung:</span>
															<span>{row.normalized.currency}</span>
														</div>
														<div className="flex gap-2">
															<span className="font-medium">Gültig ab:</span>
															<span>{row.normalized.validFrom}</span>
														</div>
														<div className="flex gap-2">
															<span className="font-medium">Stufe:</span>
															<span>context_length</span>
														</div>
													</>
												)}
											</div>
										) : (
											"—"
										)}
									</td>
									<td>{row.conflict === "conflict" ? "Konflikt" : "—"}</td>
									<td>
										<select
											onChange={(event) =>
												setPreview((currentRows) =>
													currentRows.map((item) =>
														item.index === row.index
															? {
																	...item,
																	baseStatus: item.baseStatus ?? item.status,
																	decision: event.target.value as
																		| "skip"
																		| "replace"
																		| "ignore",
																	status:
																		event.target.value === "ignore"
																			? "ignored"
																			: (item.baseStatus ?? item.status),
																}
															: item,
													),
												)
											}
											value={row.decision}
										>
											<option value="skip">
												{row.status === "conflict"
													? "Überspringen"
													: row.classification === "insert"
														? "Automatisch einfügen"
														: row.classification === "older"
															? "Automatisch überspringen (älter)"
															: row.classification === "unchanged"
																? "Unverändert lassen"
																: "Entscheidung erforderlich"}
											</option>
											<option
												disabled={row.status !== "conflict"}
												value="replace"
											>
												Ersetzen (Konflikt)
											</option>
											<option value="ignore">Explizit ignorieren</option>
										</select>
									</td>
									<td>
										<details>
											<summary className="cursor-pointer underline">
												Anzeigen
											</summary>
											<pre className="max-w-md overflow-auto whitespace-pre-wrap text-xs">
												{JSON.stringify(row.raw, null, 2)}
											</pre>
										</details>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
				{preview.length > 0 && (
					<Button
						className="mt-4"
						disabled={preview.some(
							(row) =>
								!["mapped", "ignored", "conflict"].includes(row.status) &&
								row.decision !== "ignore",
						)}
						onClick={() =>
							importer.mutate({
								auditId: auditId ?? 0,
								rows: preview.map((row) => ({
									index: row.index,
									decision: row.decision,
								})),
							})
						}
					>
						Import speichern
					</Button>
				)}
			</section>
			<section className="space-y-4 rounded-lg border p-6">
				<div className="flex items-center gap-2">
					<h2 className="font-semibold">Mapping-Regeln</h2>
					<input
						accept="application/json,.json"
						className="hidden"
						onChange={importRuleFile}
						ref={rulesFileInput}
						type="file"
					/>
					<Button
						onClick={() => rulesFileInput.current?.click()}
						size="sm"
						variant="outline"
					>
						Regeln importieren
					</Button>
					<Button
						disabled={selectedRuleIds.size === 0}
						onClick={exportRules}
						size="sm"
						variant="outline"
					>
						Auswahl exportieren
					</Button>
					<Dialog onOpenChange={setHelpOpen} open={helpOpen}>
						<DialogTrigger
							render={
								<Button
									aria-label="Hilfe zu Mapping-Regeln"
									size="icon-xs"
									variant="outline"
								/>
							}
						>
							<CircleHelp />
						</DialogTrigger>
						<DialogContent className="max-h-[90vh] max-w-2xl overflow-auto">
							<DialogHeader>
								<DialogTitle>Mapping-Regel anlegen</DialogTitle>
								<DialogDescription>
									Eine Regel verbindet Azure-Meter mit einem vorhandenen Modell
									und der passenden Abrechnungsart.
								</DialogDescription>
							</DialogHeader>
							<div className="space-y-4 text-xs/relaxed">
								<p>
									Beispiel für den Input-Meter von <code>gpt-5.6-luna</code>:
								</p>
								<pre className="overflow-auto rounded bg-muted p-3">
									{`Bedingungen:
[
  {
    "field": "meterName",
    "operator": "contains",
    "value": "5.6 luna ShortCo Cd Inp"
  }
]

Zuweisungen:
{
  "model": "gpt-5.6-luna",
  "requestType": "CHAT_COMPLETION",
  "billingUnit": "TOKENS",
  "tokenType": "input"
}`}
								</pre>
								<ol className="list-decimal space-y-1 pl-5">
									<li>
										Make sure <code>gpt-5.6-luna</code> already exists under
										<strong>Modelle</strong>.
									</li>
									<li>
										Enter a rule name such as
										<code>5.6 luna input</code> and choose action
										<code>map</code>.
									</li>
									<li>
										Set the conditions JSON and assignments JSON as shown above,
										then click <strong>Regel anlegen</strong>.
									</li>
									<li>
										Create equivalent rules for output and cache-write meters,
										using
										<code>output</code> or <code>cache_write</code> as the token
										type.
									</li>
									<li>
										Save the Azure configuration, click{" "}
										<strong>Azure laden</strong>, and review every fetched row
										before importing.
									</li>
								</ol>
								<p className="text-muted-foreground">
									For dynamic model names, use a regex condition with a named
									capture, for example <code>(?&lt;model&gt;gpt-[\\w.-]+)</code>
									, and set the assignment to <code>${"{model}"}</code>. The
									captured value must match an existing model exactly.
								</p>
							</div>
						</DialogContent>
					</Dialog>
				</div>
				<div className="grid gap-3 md:grid-cols-4">
					<label
						className="flex flex-col gap-1 text-sm"
						htmlFor="azure-rule-name"
					>
						<span>Regelname</span>
						<Input
							id="azure-rule-name"
							onChange={(e) => setRuleName(e.target.value)}
							placeholder="z. B. 5.6 luna input"
							value={ruleName}
						/>
						<span className="text-muted-foreground text-xs">
							Interner, frei wählbarer Name der Regel.
						</span>
					</label>
					<label
						className="flex flex-col gap-1 text-sm"
						htmlFor="azure-rule-priority"
					>
						<span>Priorität</span>
						<Input
							id="azure-rule-priority"
							onChange={(e) => setRulePriority(e.target.value)}
							type="number"
							value={rulePriority}
						/>
						<span className="text-muted-foreground text-xs">
							Höher gewinnt bei mehreren Regeln für dasselbe Feld.
						</span>
					</label>
					<label
						className="flex flex-col gap-1 text-sm"
						htmlFor="azure-rule-action"
					>
						<span>Aktion</span>
						<select
							className="h-9 rounded-md border bg-transparent px-3 text-sm"
							id="azure-rule-action"
							onChange={(e) =>
								setRuleAction(e.target.value as "map" | "ignore")
							}
							value={ruleAction}
						>
							<option value="map">map – Felder zuweisen</option>
							<option value="ignore">ignore – Zeile überspringen</option>
						</select>
						<span className="text-muted-foreground text-xs">
							Mappt eine Zeile oder markiert sie ausdrücklich zum Ignorieren.
						</span>
					</label>
					<Button
						className="self-start md:mt-6"
						onClick={() => {
							try {
								if (editingRuleId)
									updateRule.mutate({
										name: ruleName,
										enabled: true,
										priority: Number(rulePriority),
										action: ruleAction,
										conditions: JSON.parse(ruleConditions),
										assignments: JSON.parse(ruleAssignments),
										id: editingRuleId,
									} as never);
								else
									createRule.mutate({
										name: ruleName,
										enabled: true,
										priority: Number(rulePriority),
										action: ruleAction,
										conditions: JSON.parse(ruleConditions),
										assignments: JSON.parse(ruleAssignments),
									});
								setEditingRuleId(null);
							} catch {
								toast.error(
									"Conditions/Assignments müssen gültiges JSON sein.",
								);
							}
						}}
					>
						{editingRuleId ? "Regel speichern" : "Regel anlegen"}
					</Button>
				</div>
				<div className="grid gap-3 md:grid-cols-2">
					<label
						className="flex flex-col gap-1 text-sm"
						htmlFor="azure-rule-conditions"
					>
						<span>Bedingungen (JSON)</span>
						<span className="text-muted-foreground text-xs">
							Welche Azure-Zeilen passen? Alle Bedingungen müssen erfüllt sein.
							Unterstützt werden unter anderem <code>equals</code>,{" "}
							<code>contains</code> und <code>regex</code>.
						</span>
						<Textarea
							id="azure-rule-conditions"
							onChange={(e) => setRuleConditions(e.target.value)}
							placeholder='[{"field":"meterName","operator":"contains","value":"..."}]'
							value={ruleConditions}
						/>
					</label>
					<label
						className="flex flex-col gap-1 text-sm"
						htmlFor="azure-rule-assignments"
					>
						<span>Zuweisungen (JSON)</span>
						<span className="text-muted-foreground text-xs">
							Welche Modelldaten werden gesetzt? Regeln dürfen auch nur einzelne
							Felder beisteuern.
						</span>
						<Textarea
							id="azure-rule-assignments"
							onChange={(e) => setRuleAssignments(e.target.value)}
							placeholder='{"model":"gpt-4o","requestType":"CHAT_COMPLETION","billingUnit":"TOKENS","tokenType":"input"}'
							value={ruleAssignments}
						/>
					</label>
				</div>
				<div className="flex flex-wrap items-center gap-2 border-t pt-3 text-sm">
					<span className="text-muted-foreground">
						{selectedRuleIds.size} Regel(n) ausgewählt
					</span>
					<Button
						onClick={() =>
							setSelectedRuleIds(
								new Set((data?.rules ?? []).map((rule) => rule.id)),
							)
						}
						size="sm"
						variant="outline"
					>
						Alle auswählen
					</Button>
					<Button
						onClick={() => setSelectedRuleIds(new Set())}
						size="sm"
						variant="outline"
					>
						Auswahl aufheben
					</Button>
				</div>
				{(data?.rules ?? []).map((rule) => (
					<div
						className="flex items-center justify-between border-t py-2 text-sm"
						key={rule.id}
					>
						<label className="flex items-center gap-2">
							<input
								checked={selectedRuleIds.has(rule.id)}
								onChange={(event) =>
									setSelectedRuleIds((current) => {
										const next = new Set(current);
										if (event.target.checked) next.add(rule.id);
										else next.delete(rule.id);
										return next;
									})
								}
								type="checkbox"
							/>
							<span>
								{rule.name} · Priorität {rule.priority} · {rule.action} (
								{rule.enabled ? "aktiv" : "deaktiviert"})
							</span>
						</label>
						<span className="flex gap-2">
							<Button
								onClick={() => {
									setEditingRuleId(rule.id);
									setRuleName(rule.name);
									setRulePriority(String(rule.priority));
									setRuleAction(rule.action as "map" | "ignore");
									setRuleConditions(JSON.stringify(rule.conditions));
									setRuleAssignments(JSON.stringify(rule.assignments));
								}}
								size="sm"
								variant="outline"
							>
								Bearbeiten
							</Button>
							<Button
								onClick={() =>
									updateRule.mutate({
										...rule,
										enabled: !rule.enabled,
									} as never)
								}
								size="sm"
								variant="outline"
							>
								{rule.enabled ? "Deaktivieren" : "Aktivieren"}
							</Button>
							<Button
								onClick={() => deleteRule.mutate({ id: rule.id })}
								size="sm"
								variant="destructive"
							>
								Löschen
							</Button>
						</span>
					</div>
				))}
			</section>
			<section className="space-y-3 rounded-lg border p-6">
				<h2 className="font-semibold">Import-Audits</h2>
				{audits.map((audit) => (
					<div
						className="flex justify-between border-t py-2 text-sm"
						key={audit.id}
					>
						<span>
							{new Date(audit.createdAt).toLocaleString()} · {audit.operation} ·{" "}
							{audit.outcome}
						</span>
						<button
							className="underline"
							onClick={() => setSelectedAuditId(audit.id)}
							type="button"
						>
							Details{" "}
							{audit.fetchedAuditId ? `(Fetch #${audit.fetchedAuditId})` : ""}
						</button>
					</div>
				))}
				{selectedAudit && (
					<pre className="max-h-96 overflow-auto rounded bg-muted p-3 text-xs">
						{JSON.stringify(
							{
								configuration: selectedAudit.configuration,
								rawResponse: selectedAudit.rawResponse,
								rows: selectedAudit.rows,
								error: selectedAudit.error,
							},
							null,
							2,
						)}
					</pre>
				)}
			</section>
		</main>
	);
}
