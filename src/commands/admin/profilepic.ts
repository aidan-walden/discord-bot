import {
	type ChatInputCommandInteraction,
	MessageFlags,
	SlashCommandBuilder,
} from "discord.js";
import {
	isHttpImageUrl,
	ProfilePictureValidationError,
} from "../../helpers/profilePicture";
import type Command from "../../models/Command";

export default class ProfilePic implements Command {
	data = new SlashCommandBuilder()
		.setName("pfp")
		.setDescription("Manage the bot profile picture")
		.addSubcommand((subcommand) =>
			subcommand
				.setName("set")
				.setDescription("Set the bot profile picture")
				.addStringOption((option) =>
					option
						.setName("url")
						.setDescription("Direct HTTP(S) image URL")
						.setRequired(true),
				)
				.addBooleanOption((option) =>
					option
						.setName("force")
						.setDescription(
							"Prevent scheduled profile pictures from replacing it",
						)
						.setRequired(false),
				),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("reset")
				.setDescription("Release the forced profile picture override"),
		);

	async execute(interaction: ChatInputCommandInteraction): Promise<void> {
		const bot = interaction.client.bot;
		if (!bot.permissions.isAdminUser(interaction.user.id)) {
			await interaction.reply({
				content: "You don't have permission to use this command.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const subcommand = interaction.options.getSubcommand();
		if (subcommand === "set") {
			await this.handleSet(interaction);
			return;
		}

		await this.handleReset(interaction);
	}

	private async handleSet(
		interaction: ChatInputCommandInteraction,
	): Promise<void> {
		const url = interaction.options.getString("url", true);
		if (!isHttpImageUrl(url)) {
			await interaction.reply({
				content: "Provide a direct HTTP(S) image URL.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const force = interaction.options.getBoolean("force") ?? false;
		try {
			await interaction.client.bot.setProfilePicture(url, force);
		} catch (error) {
			if (error instanceof ProfilePictureValidationError) {
				await interaction.reply({
					content: "That URL did not return a valid image MIME type.",
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			console.error("Failed to set profile picture:", error);
			await interaction.reply({
				content: "Failed to set the profile picture.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await interaction.reply({
			content: "Profile picture updated.",
			flags: MessageFlags.Ephemeral,
		});
	}

	private async handleReset(
		interaction: ChatInputCommandInteraction,
	): Promise<void> {
		const bot = interaction.client.bot;
		await bot.releaseProfilePictureOverride();
		await bot.applyHolidayProfilePicture(bot.holidays.getCanonicalHoliday());

		await interaction.reply({
			content: "Profile picture override reset.",
			flags: MessageFlags.Ephemeral,
		});
	}
}
