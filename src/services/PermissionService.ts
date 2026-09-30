import type BanRepository from "../repositories/BanRepository";

export default class PermissionService {
	constructor(
		private readonly adminUserIds: ReadonlySet<string>,
		readonly gptUserBans: BanRepository,
		readonly musicUserBans: BanRepository,
		readonly musicGuildBans: BanRepository,
	) {}

	isAdminUser(userId: string): boolean {
		return this.adminUserIds.has(userId);
	}

	async getMusicUsageBlockReason(
		userId: string,
		guildId: string,
	): Promise<string | null> {
		const [userBanned, guildBanned] = await Promise.all([
			this.musicUserBans.has(userId),
			this.musicGuildBans.has(guildId),
		]);
		if (userBanned) {
			return "You're banned from using music commands.";
		}

		if (guildBanned) {
			return "This server is banned from using music commands. If you move servers, music bot will work normally there.";
		}

		return null;
	}

	async isGptUserBanned(userId: string): Promise<boolean> {
		return this.gptUserBans.has(userId);
	}
}
