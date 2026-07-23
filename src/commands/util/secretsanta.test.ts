import { describe, expect, mock, test } from "bun:test";
import {
	type ChatInputCommandInteraction,
	MessageFlags,
	type User,
} from "discord.js";
import SecretSanta from "./secretsanta";

type Draw = {
	name: string;
	open: boolean;
	spendLimitCents: number | null;
	drawnAt: Date | null;
	revision: number;
	createdAt: Date;
};

function draw(partial: Partial<Draw> & { name: string }): Draw {
	return {
		open: true,
		spendLimitCents: null,
		drawnAt: null,
		revision: 0,
		createdAt: new Date(),
		...partial,
	};
}

function buildInteraction(opts: {
	sub: string;
	admin?: boolean;
	userId?: string;
	name?: string | null;
	amountUsd?: number;
	users?: Record<string, { id: string } | null>;
	secretSanta?: Record<string, ReturnType<typeof mock>>;
	click?: "yes" | "no";
	events?: string[];
}): ChatInputCommandInteraction {
	const userId = opts.userId ?? "admin-1";
	const secretSanta = {
		get: mock(async () => null),
		list: mock(async () => []),
		create: mock(async (name: string) => draw({ name })),
		delete: mock(async () => false),
		setOpen: mock(async () => null),
		setSpendLimitCents: mock(async () => null),
		addParticipant: mock(async () => "added"),
		removeParticipant: mock(async () => "removed"),
		listParticipants: mock(async () => [] as string[]),
		addExclusions: mock(async () => 0),
		listExclusions: mock(async () => [] as { userA: string; userB: string }[]),
		finalizeAssignments: mock(async () => ({ status: "missing" })),
		listAssignments: mock(async () => []),
		participantCount: mock(async () => 0),
		...opts.secretSanta,
	};

	return {
		id: "interaction-1",
		user: { id: userId },
		options: {
			getSubcommand: mock(() => opts.sub),
			getString: mock((key: string) => {
				if (key === "name") {
					return opts.name === undefined ? "party" : opts.name;
				}
				return null;
			}),
			getNumber: mock(() => opts.amountUsd ?? null),
			getUser: mock((key: string, required?: boolean) => {
				const u = opts.users?.[key];
				if (u) {
					return u as User;
				}
				if (required) {
					return { id: "missing" } as User;
				}
				return null;
			}),
		},
		client: {
			bot: {
				permissions: {
					isAdminUser: mock((id: string) =>
						opts.admin === false ? false : id === userId || opts.admin === true,
					),
				},
				secretSanta,
			},
			users: {
				fetch: mock(async () => {
					opts.events?.push("dm");
					return { send: mock(async () => undefined) };
				}),
			},
		},
		reply: mock(
			async (payload: {
				components?: { components: { data: { custom_id?: string } }[] }[];
			}) => ({
				awaitMessageComponent: mock(async () => {
					if (!opts.click) throw new Error("timeout");
					const index = opts.click === "yes" ? 0 : 1;
					return {
						customId:
							payload.components?.[0]?.components[index]?.data.custom_id,
						user: { id: userId },
						deferUpdate: mock(async () => {
							opts.events?.push("defer");
						}),
						update: mock(async () => undefined),
					};
				}),
			}),
		),
		deferReply: mock(async () => undefined),
		editReply: mock(async () => undefined),
	} as unknown as ChatInputCommandInteraction;
}

describe("SecretSanta", () => {
	test("denies non-admin on init", async () => {
		const interaction = buildInteraction({
			sub: "init",
			admin: false,
			userId: "pleb",
		});
		await new SecretSanta().execute(interaction);
		expect(interaction.reply).toHaveBeenCalledWith({
			content: "You don't have permission to use this command.",
			flags: MessageFlags.Ephemeral,
		});
	});

	test("init creates draw", async () => {
		const interaction = buildInteraction({ sub: "init", name: "work-2026" });
		await new SecretSanta().execute(interaction);
		expect(interaction.client.bot.secretSanta.create).toHaveBeenCalledWith(
			"work-2026",
		);
		expect(interaction.reply).toHaveBeenCalledWith({
			content: "Created Secret Santa draw `work-2026` (opt-in open).",
			flags: MessageFlags.Ephemeral,
		});
	});

	test("opt-in blocked when closed", async () => {
		const interaction = buildInteraction({
			sub: "opt-in",
			name: "party",
			secretSanta: {
				addParticipant: mock(async () => "closed"),
			},
		});
		await new SecretSanta().execute(interaction);
		expect(interaction.reply).toHaveBeenCalledWith({
			content: "Opt-in is closed for this draw.",
			flags: MessageFlags.Ephemeral,
		});
		expect(interaction.client.bot.secretSanta.get).not.toHaveBeenCalled();
	});

	test("opt-in blocked when drawn", async () => {
		const interaction = buildInteraction({
			sub: "opt-in",
			name: "party",
			secretSanta: {
				addParticipant: mock(async () => "locked"),
			},
		});
		await new SecretSanta().execute(interaction);
		expect(interaction.reply).toHaveBeenCalledWith({
			content: "This draw already has pairings; the roster is locked.",
			flags: MessageFlags.Ephemeral,
		});
	});

	test("opt-out blocked atomically when drawn", async () => {
		const interaction = buildInteraction({
			sub: "opt-out",
			secretSanta: { removeParticipant: mock(async () => "locked") },
		});
		await new SecretSanta().execute(interaction);
		expect(interaction.reply).toHaveBeenCalledWith({
			content: "This draw already has pairings; the roster is locked.",
			flags: MessageFlags.Ephemeral,
		});
		expect(interaction.client.bot.secretSanta.get).not.toHaveBeenCalled();
	});

	test("status list never includes pairings field data from assignments", async () => {
		const listAssignments = mock(async () => [
			{ giverId: "a", recipientId: "b" },
		]);
		const interaction = buildInteraction({
			sub: "status",
			name: null,
			secretSanta: {
				list: mock(async () => [
					draw({ name: "party", spendLimitCents: 2500 }),
				]),
				participantCount: mock(async () => 3),
				listAssignments,
			},
		});
		await new SecretSanta().execute(interaction);
		expect(listAssignments).not.toHaveBeenCalled();
		expect(interaction.reply).toHaveBeenCalledWith({
			content: "`party` — open, not drawn, 3 participant(s), $25.00",
			flags: MessageFlags.Ephemeral,
		});
	});

	test("draw confirm shows Yes/No buttons", async () => {
		const interaction = buildInteraction({
			sub: "draw",
			name: "party",
			secretSanta: {
				get: mock(async () => draw({ name: "party", spendLimitCents: 1000 })),
				listParticipants: mock(async () => ["u1", "u2", "u3"]),
			},
		});
		await new SecretSanta().execute(interaction);

		const payload = (interaction.reply as ReturnType<typeof mock>).mock
			.calls[0]?.[0] as {
			embeds: { data: { description?: string } }[];
			components: {
				components: { data: { custom_id?: string; label?: string } }[];
			}[];
		};

		expect(payload.embeds[0]?.data.description).toBe(
			"Do you really want to draw pairings now?",
		);
		const labels = payload.components[0]?.components.map((c) => c.data.label);
		expect(labels).toEqual(["Yes", "No"]);
		const ids = payload.components[0]?.components.map((c) => c.data.custom_id);
		expect(ids?.[0]).toContain("secretsanta:draw:yes:");
		expect(ids?.[1]).toContain("secretsanta:draw:no:");
	});

	test("draw defers before finalizing and DMs committed pairs", async () => {
		const events: string[] = [];
		const committed = [
			{ giverId: "u1", recipientId: "u2" },
			{ giverId: "u2", recipientId: "u3" },
			{ giverId: "u3", recipientId: "u1" },
		];
		const interaction = buildInteraction({
			sub: "draw",
			click: "yes",
			events,
			secretSanta: {
				get: mock(async () => draw({ name: "party" })),
				listParticipants: mock(async () => ["u1", "u2"]),
				finalizeAssignments: mock(async () => {
					events.push("finalize");
					return {
						status: "committed",
						draw: draw({ name: "party", revision: 1 }),
						pairs: committed,
					};
				}),
			},
		});
		await new SecretSanta().execute(interaction);

		expect(events).toEqual(["defer", "finalize", "dm", "dm", "dm"]);
		expect(interaction.client.users.fetch).toHaveBeenCalledTimes(3);
		expect(interaction.editReply).toHaveBeenLastCalledWith({
			content: "Drew 3 pairing(s) for `party`. All DMs sent.",
			embeds: [],
			components: [],
		});
	});

	test("stale confirmation sends no DMs and is not a timeout", async () => {
		const interaction = buildInteraction({
			sub: "draw",
			click: "yes",
			secretSanta: {
				get: mock(async () => draw({ name: "party" })),
				listParticipants: mock(async () => ["u1", "u2"]),
				finalizeAssignments: mock(async () => ({ status: "stale" })),
			},
		});
		await new SecretSanta().execute(interaction);

		expect(interaction.client.users.fetch).not.toHaveBeenCalled();
		expect(interaction.editReply).toHaveBeenCalledWith({
			content:
				"This draw changed while awaiting confirmation. No changes made.",
			embeds: [],
			components: [],
		});
	});

	test("participant embed fields fit Discord's limit", async () => {
		const participants = Array.from(
			{ length: 100 },
			(_, index) => `${100000000000000000n + BigInt(index)}`,
		);
		for (const [sub, name] of [
			["status", "party"],
			["draw", "party"],
		] as const) {
			const interaction = buildInteraction({
				sub,
				name,
				secretSanta: {
					get: mock(async () => draw({ name })),
					listParticipants: mock(async () => participants),
				},
			});
			await new SecretSanta().execute(interaction);
			const payload = (interaction.reply as ReturnType<typeof mock>).mock
				.calls[0]?.[0] as {
				embeds: { data: { fields?: { name: string; value: string }[] } }[];
			};
			const field = payload.embeds[0]?.data.fields?.find((candidate) =>
				candidate.name.startsWith("Participants"),
			);
			expect(field?.value.length).toBeLessThanOrEqual(1024);
			const parts = field?.value.split(", ") ?? [];
			expect(field?.value).toEndWith(
				`and ${participants.length - parts.length + 1} more`,
			);
		}
	});

	test("rejects invalid name", async () => {
		const interaction = buildInteraction({
			sub: "init",
			name: "bad name!",
		});
		await new SecretSanta().execute(interaction);
		expect(interaction.reply).toHaveBeenCalledWith({
			content: "Invalid name. Use 1–32 characters: letters, numbers, `_`, `-`.",
			flags: MessageFlags.Ephemeral,
		});
		expect(interaction.client.bot.secretSanta.create).not.toHaveBeenCalled();
	});
});
