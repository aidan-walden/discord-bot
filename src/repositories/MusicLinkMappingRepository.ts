import { asc, eq } from "drizzle-orm";
import type { Database } from "../database/client";
import { musicLinkMappings } from "../database/schema";
import type { MusicPlatform } from "../services/musicTypes";

const MUSIC_LINK_MAPPING_LOOKUP_LIMIT = 5;

export default class MusicLinkMappingRepository {
	constructor(private readonly db: Database) {}

	async findOtherIds(
		platform: MusicPlatform,
		entityId: string,
	): Promise<string[]> {
		const rows =
			platform === "spotify"
				? await this.db
						.select({ entityId: musicLinkMappings.appleMusicId })
						.from(musicLinkMappings)
						.where(eq(musicLinkMappings.spotifyId, entityId))
						.orderBy(asc(musicLinkMappings.appleMusicId))
						.limit(MUSIC_LINK_MAPPING_LOOKUP_LIMIT)
				: await this.db
						.select({ entityId: musicLinkMappings.spotifyId })
						.from(musicLinkMappings)
						.where(eq(musicLinkMappings.appleMusicId, entityId))
						.orderBy(asc(musicLinkMappings.spotifyId))
						.limit(MUSIC_LINK_MAPPING_LOOKUP_LIMIT);

		return rows.map((row) => row.entityId);
	}

	async record(spotifyId: string, appleMusicId: string): Promise<void> {
		await this.db
			.insert(musicLinkMappings)
			.values({ spotifyId, appleMusicId })
			.onConflictDoNothing();
	}
}
