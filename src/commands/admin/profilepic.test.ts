import { describe, expect, mock, test } from "bun:test";
import { type ChatInputCommandInteraction, MessageFlags } from "discord.js";
import { ProfilePictureValidationError } from "../../helpers/profilePicture";
import Holiday from "../../models/Holiday";
import ProfilePic from "./profilepic";

type BuildInteractionOptions = {
	admin?: boolean;
	subcommand?: "set" | "reset";
	url?: string;
	force?: boolean | null;
	setProfilePicture?: (url: string, force: boolean) => Promise<void>;
};

function buildInteraction({
	admin = true,
	subcommand = "set",
	url = "https://example.com/avatar.png",
	force = null,
	setProfilePicture = async () => undefined,
}: BuildInteractionOptions = {}): ChatInputCommandInteraction {
	return {
		user: {
			id: "executing-user",
		},
		options: {
			getSubcommand: mock(() => subcommand),
			getString: mock(() => url),
			getBoolean: mock(() => force),
		},
		client: {
			bot: {
				permissions: {
					isAdminUser: mock(() => admin),
				},
				setProfilePicture: mock(setProfilePicture),
				releaseProfilePictureOverride: mock(async () => undefined),
				applyHolidayProfilePicture: mock(async () => undefined),
				holidays: {
					getCanonicalHoliday: mock(() => Holiday.Xmas),
				},
			},
		},
		reply: mock(async () => undefined),
	} as unknown as ChatInputCommandInteraction;
}

describe("ProfilePic", () => {
	test("rejects non-admin users before doing work", async () => {
		const command = new ProfilePic();
		const interaction = buildInteraction({ admin: false });

		await command.execute(interaction);

		expect(interaction.client.bot.permissions.isAdminUser).toHaveBeenCalledWith(
			"executing-user",
		);
		expect(interaction.client.bot.setProfilePicture).not.toHaveBeenCalled();
		expect(interaction.reply).toHaveBeenCalledWith({
			content: "You don't have permission to use this command.",
			flags: MessageFlags.Ephemeral,
		});
	});

	test("rejects invalid direct image URLs", async () => {
		const command = new ProfilePic();
		const interaction = buildInteraction({
			url: "https://example.com/avatar.txt",
		});

		await command.execute(interaction);

		expect(interaction.client.bot.setProfilePicture).not.toHaveBeenCalled();
		expect(interaction.reply).toHaveBeenCalledWith({
			content: "Provide a direct HTTP(S) image URL.",
			flags: MessageFlags.Ephemeral,
		});
	});

	test("reports invalid image MIME type from setProfilePicture", async () => {
		const command = new ProfilePic();
		const interaction = buildInteraction({
			setProfilePicture: async () => {
				throw new ProfilePictureValidationError("Invalid MIME type.");
			},
		});

		await command.execute(interaction);

		expect(interaction.reply).toHaveBeenCalledWith({
			content: "That URL did not return a valid image MIME type.",
			flags: MessageFlags.Ephemeral,
		});
	});

	test("sets profile picture with force defaulting to false", async () => {
		const command = new ProfilePic();
		const interaction = buildInteraction();

		await command.execute(interaction);

		expect(interaction.client.bot.setProfilePicture).toHaveBeenCalledWith(
			"https://example.com/avatar.png",
			false,
		);
		expect(interaction.reply).toHaveBeenCalledWith({
			content: "Profile picture updated.",
			flags: MessageFlags.Ephemeral,
		});
	});

	test("passes force true when requested", async () => {
		const command = new ProfilePic();
		const interaction = buildInteraction({ force: true });

		await command.execute(interaction);

		expect(interaction.client.bot.setProfilePicture).toHaveBeenCalledWith(
			"https://example.com/avatar.png",
			true,
		);
	});

	test("reset releases override and applies current holiday profile picture", async () => {
		const command = new ProfilePic();
		const interaction = buildInteraction({ subcommand: "reset" });

		await command.execute(interaction);

		expect(
			interaction.client.bot.releaseProfilePictureOverride,
		).toHaveBeenCalled();
		expect(
			interaction.client.bot.holidays.getCanonicalHoliday,
		).toHaveBeenCalled();
		expect(
			interaction.client.bot.applyHolidayProfilePicture,
		).toHaveBeenCalledWith(Holiday.Xmas);
		expect(interaction.reply).toHaveBeenCalledWith({
			content: "Profile picture override reset.",
			flags: MessageFlags.Ephemeral,
		});
	});
});
